import log from 'electron-log/renderer';
import { computed, ref, shallowRef } from 'vue';

import { IPC_EVENTS } from '@/events';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import {
	shouldExpandTimelineAfterReattach,
	type ReviewTimelineReattachedPayload,
	type ReviewTimelineViewMode,
	type ReviewTimelineWindowAction,
} from '@/timelineWindow';

type TimelineWindowActionHandler = (action: ReviewTimelineWindowAction) => boolean;

type ReviewTimelineWindowStateOptions = {
	onReattached: () => void;
};

export function useReviewTimelineWindowState(options: ReviewTimelineWindowStateOptions) {
	const detached = ref(false);
	const expanded = ref(false);
	const viewMode = ref<ReviewTimelineViewMode>('fight');
	const returnToReviewsRevision = ref(0);
	const pendingActions = shallowRef<ReviewTimelineWindowAction[]>([]);
	let actionHandler: TimelineWindowActionHandler | null = null;

	const hasPendingActions = computed(() => pendingActions.value.length > 0);

	function isSeekAction(action: ReviewTimelineWindowAction): boolean {
		return action.type === 'seek' || action.type === 'seek-pull';
	}

	function coalesceActions(actions: ReviewTimelineWindowAction[]): ReviewTimelineWindowAction[] {
		let newestSeekIndex = -1;
		for (let index = actions.length - 1; index >= 0; index--) {
			if (!isSeekAction(actions[index])) continue;
			newestSeekIndex = index;
			break;
		}
		return actions.filter((action, index) => (
			!isSeekAction(action) || index === newestSeekIndex
		));
	}

	function flushPendingActions(): void {
		if (!actionHandler || pendingActions.value.length === 0) return;
		const queuedActions = coalesceActions(pendingActions.value);
		pendingActions.value = [];
		const deferredActions: ReviewTimelineWindowAction[] = [];
		queuedActions.forEach(action => {
			try {
				if (!actionHandler?.(action)) deferredActions.push(action);
			} catch (error) {
				log.error('Failed to handle detached timeline action', { action, error });
				deferredActions.push(action);
			}
		});
		if (deferredActions.length > 0) {
			pendingActions.value = coalesceActions([
				...deferredActions,
				...pendingActions.value,
			]);
		}
	}

	function registerActionHandler(handler: TimelineWindowActionHandler): () => void {
		actionHandler = handler;
		flushPendingActions();
		return () => {
			if (actionHandler === handler) actionHandler = null;
		};
	}

	function receiveAction(action: ReviewTimelineWindowAction): void {
		if (!action?.type) return;
		if (actionHandler) {
			try {
				if (actionHandler(action)) return;
			} catch (error) {
				log.error('Failed to handle detached timeline action', { action, error });
			}
		}
		// Player hotkeys describe a momentary key press and must never execute later
		// against a newly mounted or newly loaded Reviews player.
		if (action.type === 'player-hotkey') return;
		pendingActions.value = coalesceActions([
			...pendingActions.value,
			action,
		]).slice(-50);
	}

	useIpcOn(IPC_EVENTS.TIMELINE_WINDOW_ACTION, (_event, action: ReviewTimelineWindowAction) => {
		receiveAction(action);
	});

	useIpcOn(
		IPC_EVENTS.TIMELINE_WINDOW_REATTACHED,
		(_event, input?: ReviewTimelineReattachedPayload) => {
			detached.value = false;
			// The native close button puts both representations away. "Return to
			// Reviews" deliberately reattaches the expanded view, while automatic
			// reattachment caused by the main window being hidden/minimized keeps
			// the full timeline open as before.
			expanded.value = shouldExpandTimelineAfterReattach(input);
			options.onReattached();
			if (input?.returnToReviews) returnToReviewsRevision.value++;
		},
	);

	return {
		detached,
		expanded,
		flushPendingActions,
		hasPendingActions,
		registerActionHandler,
		returnToReviewsRevision,
		viewMode,
	};
}
