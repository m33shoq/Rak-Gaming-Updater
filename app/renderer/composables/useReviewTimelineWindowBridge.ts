import log from 'electron-log/renderer';
import { onBeforeUnmount, onMounted, watch, type ComputedRef, type Ref } from 'vue';

import { IPC_EVENTS } from '@/events';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';
import type { ReviewSeekSource } from '@/renderer/reviewSeekCoordinator';
import type { ReviewTimelineWindowAction, ReviewTimelineWindowContext } from '@/timelineWindow';

type ReviewTimelineWindowBridgeOptions = {
	cursorPercent: ComputedRef<number>;
	isPlaying: Ref<boolean>;
	phases: ComputedRef<ReviewTimelineWindowContext['phases']>;
	isPlayerReady: () => boolean;
	seekFight: (timestampSeconds: number, source: ReviewSeekSource) => void;
	seekPull: (fightID: number, timestampSeconds: number, source: ReviewSeekSource) => void;
	togglePlayback: () => void;
};

export function useReviewTimelineWindowBridge(options: ReviewTimelineWindowBridgeOptions) {
	const reviewsStore = useReviewsStore();
	let unregisterActionHandler: (() => void) | null = null;

	function openWCLDeath(deathID: number): void {
		if (!reviewsStore.selectedReportCode || !reviewsStore.selectedFightID) return;
		openWCLPullDeath(reviewsStore.selectedFightID, deathID);
	}

	function openWCLFight(fightID?: number): void {
		const targetFightID = fightID || reviewsStore.selectedFightID;
		if (!reviewsStore.selectedReportCode || !targetFightID) return;
		ipc.send(IPC_EVENTS.WCL_OPEN_FIGHT, {
			reportCode: reviewsStore.selectedReportCode,
			fightID: targetFightID,
		});
	}

	function openWCLPullDeath(fightID: number, deathID: number): void {
		if (!reviewsStore.selectedReportCode) return;
		ipc.send(IPC_EVENTS.WCL_OPEN_DEATH, {
			reportCode: reviewsStore.selectedReportCode,
			fightID,
			deathID,
		});
	}

	function buildContext(includeAllCachedPulls = false): ReviewTimelineWindowContext | null {
		const reportCode = reviewsStore.selectedReportCode;
		const fightID = reviewsStore.selectedFightID;
		const reportDetails = reviewsStore.getReportDetails;
		const fight = reviewsStore.getSelectedFight;
		if (!reportCode || !fightID || !reportDetails || !fight) return null;

		const context: ReviewTimelineWindowContext = {
			reportCode,
			fightID,
			reportDetails,
			dataSnapshot: reviewsStore.createTimelineWindowDataSnapshot(
				reportCode,
				includeAllCachedPulls ? undefined : [fightID],
			),
			phases: options.phases.value,
			fightStartTime: reviewsStore.getFightStartTimeOffset,
			fightDuration: reviewsStore.getFightDuration,
			cursorPercent: options.cursorPercent.value,
			playing: options.isPlaying.value,
			viewMode: reviewsStore.timelineViewMode,
			title: `${fight.name} · Fight #${fight.id}`,
		};

		// Pinia wraps nested report data in Vue proxies. Build a plain snapshot before
		// crossing the isolated renderer boundary.
		return JSON.parse(JSON.stringify(context)) as ReviewTimelineWindowContext;
	}

	async function detachTimeline(): Promise<void> {
		const context = buildContext(true);
		if (!context) return;
		try {
			const response = await ipc.invoke(
				IPC_EVENTS.TIMELINE_WINDOW_OPEN,
				context,
			) as { success?: boolean; error?: string };
			if (!response?.success) {
				throw new Error(response?.error || 'Timeline window could not be opened.');
			}
			const status = await ipc.invoke(
				IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET,
			) as { detached?: boolean };
			reviewsStore.timelineWindowDetached = status?.detached === true;
			reviewsStore.timelineExpanded = true;
		} catch (error) {
			log.error('Failed to detach review timeline', error);
		}
	}

	function sendContext(): void {
		if (!reviewsStore.timelineWindowDetached) return;
		const context = buildContext();
		if (!context) {
			ipc.send(IPC_EVENTS.TIMELINE_WINDOW_REATTACH, { reason: 'context-unavailable' });
			return;
		}
		ipc.send(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_SET, context);
	}

	function handleAction(action: ReviewTimelineWindowAction): boolean {
		switch (action.type) {
			case 'seek':
				if (!options.isPlayerReady()) return false;
				options.seekFight(action.timestampSeconds, 'detached-timeline');
				return true;
			case 'seek-pull':
				if (!options.isPlayerReady()) return false;
				options.seekPull(action.fightID, action.timestampSeconds, 'detached-timeline');
				return true;
			case 'open-fight':
				openWCLFight(action.fightID);
				return true;
			case 'open-death':
				openWCLDeath(action.deathID);
				return true;
			case 'open-pull-death':
				openWCLPullDeath(action.fightID, action.deathID);
				return true;
			case 'toggle-playback':
				if (!options.isPlayerReady()) return false;
				options.togglePlayback();
				return true;
			case 'view-mode':
				reviewsStore.timelineViewMode = action.viewMode;
				return true;
		}
	}

	watch(
		[
			() => reviewsStore.selectedReportCode,
			() => reviewsStore.selectedFightID,
			() => reviewsStore.getReportDetails,
			() => reviewsStore.getFightEvents,
			() => reviewsStore.getFightCooldownData,
			() => reviewsStore.getFightBossCastData,
			() => reviewsStore.isFightCooldownsLoading,
			() => reviewsStore.getFightCooldownError,
			options.phases,
			() => reviewsStore.timelineViewMode,
		],
		sendContext,
	);

	watch(options.cursorPercent, (cursorPercent) => {
		if (reviewsStore.timelineWindowDetached) {
			ipc.send(IPC_EVENTS.TIMELINE_WINDOW_CURSOR_SET, cursorPercent);
		}
	});

	watch(options.isPlaying, (playing) => {
		if (reviewsStore.timelineWindowDetached) {
			ipc.send(IPC_EVENTS.TIMELINE_WINDOW_PLAYBACK_SET, playing);
		}
	});

	onMounted(async () => {
		unregisterActionHandler = reviewsStore.registerTimelineWindowActionHandler(handleAction);
		try {
			const status = await ipc.invoke(
				IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET,
			) as { detached?: boolean };
			const wasDetached = reviewsStore.timelineWindowDetached;
			reviewsStore.timelineWindowDetached = status?.detached === true;
			if (reviewsStore.timelineWindowDetached) {
				sendContext();
			} else if (wasDetached) {
				reviewsStore.timelineExpanded = true;
				void reviewsStore.reloadBossCastPreferences();
			}
		} catch (error) {
			log.error('Failed to load detached timeline status', error);
		}
	});

	onBeforeUnmount(() => {
		unregisterActionHandler?.();
		unregisterActionHandler = null;
	});

	return {
		detachTimeline,
		openWCLDeath,
		openWCLFight,
		openWCLPullDeath,
	};
}
