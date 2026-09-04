import { defineStore } from 'pinia';
import { ref, computed, watch, shallowRef, nextTick } from 'vue';
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';
import type {
	ReviewTimelineViewMode,
	ReviewTimelineWindowAction,
	ReviewTimelineWindowContext,
	ReviewTimelineWindowDataSnapshot,
} from '@/timelineWindow';

import { useYoutubeVideoInfo } from '@/renderer/composables/useYoutubeVideoInfo';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const FIGHT_DATA_CACHE_TTL_MS = 30 * 60 * 1000;
const BOSS_CAST_PREFERENCES_STORE_KEY = 'reviewBossCastVisibilityOverrides';
const BOSS_CAST_DISPLAY_MODE_STORE_KEY = 'reviewBossCastDisplayMode';
type BossCastVisibilityOverrides = Record<string, Record<string, boolean>>;
type BossCastDisplayMode = 'full' | 'collapsed';
type TimelineWindowActionHandler = (action: ReviewTimelineWindowAction) => boolean;

export const useReviewsStore = defineStore('Reviews', () => {
	const { youtubeVideoInfo, refreshYoutubeVideoInfo } = useYoutubeVideoInfo();
	const selectedVideoInfo = ref<YouTubeVideo | null>(null);
	const timelineWindowDetached = ref(false);
	const timelineExpanded = ref(false);
	const timelineViewMode = ref<ReviewTimelineViewMode>('fight');
	const timelineWindowReturnToReviewsRevision = ref(0);
	const pendingTimelineWindowActions = shallowRef<ReviewTimelineWindowAction[]>([]);
	const timelineWindowDataRevision = ref(0);
	const timelineWindowUpdatedFight = shallowRef<{ reportCode: string; fightID: number } | null>(null);
	let timelineWindowActionHandler: TimelineWindowActionHandler | null = null;

	function setSelectedVideoInfo(video: YouTubeVideo | null) {
		selectedVideoInfo.value = video;
	}

	const pendingDirectVideoSeekSeconds = ref<number | null>(null);
	function consumePendingDirectVideoSeekSeconds() {
		const value = pendingDirectVideoSeekSeconds.value;
		pendingDirectVideoSeekSeconds.value = null;
		return value;
	}

	const reports = shallowRef<Array<reportSummary>>([]);
	const selectedReportCode = ref<string | null>(null);
	const reportDetails = ref<reportDetails | null>(null);
	const selectedFightID = ref<number | null>(null);
	const savedFightEvents = ref<Record<string, fightEvent[]>>({});
	const fightEventCachedAt = ref<Record<string, number>>({});
	const fightEventRequests = ref<Record<string, boolean>>({});
	const fightEventErrors = ref<Record<string, string | null>>({});
	const savedFightCooldowns = ref<Record<string, reviewFightCooldownData>>({});
	const fightCooldownCachedAt = ref<Record<string, number>>({});
	const fightCooldownCacheEpoch = ref(0);
	const fightCooldownRequests = ref<Record<string, boolean>>({});
	const fightCooldownErrors = ref<Record<string, string | null>>({});
	const savedFightBossCasts = ref<Record<string, reviewFightBossCastData>>({});
	const fightBossCastCachedAt = ref<Record<string, number>>({});
	const fightBossCastCacheEpoch = ref(0);
	const fightBossCastRequests = ref<Record<string, boolean>>({});
	const fightBossCastErrors = ref<Record<string, string | null>>({});
	const bossCastVisibilityOverrides = ref<BossCastVisibilityOverrides>({});
	const bossCastDisplayMode = ref<BossCastDisplayMode>('collapsed');
	const bossCastPreferencesLoaded = ref(false);
	const fightEventPromises = new Map<string, Promise<fightEvent[]>>();
	const fightCooldownPromises = new Map<string, Promise<reviewFightCooldownData>>();
	const fightBossCastPromises = new Map<string, Promise<reviewFightBossCastData>>();
	let fightEventRequestEpoch = 0;
	let fightCooldownRequestEpoch = 0;
	let fightBossCastRequestEpoch = 0;
	let fightCooldownInvalidatedAt = 0;
	let fightBossCastInvalidatedAt = 0;
	let bossCastPreferencesPromise: Promise<void> | null = null;
	let timelineContextHydrationGeneration = 0;
	let timelineContextHydrating = false;

	const getSelectedVideoId = computed(() => selectedVideoInfo.value?.id || null);

	const getReports = computed(() => reports.value);
	function setReports(newReports: Array<reportSummary>) {
		reports.value = newReports;
	}
	const getSelectedReport = computed(() => selectedReportCode.value ? reports.value.find(r => r.code === selectedReportCode.value) || null : null);

	const getReportDetails = computed(() => reportDetails.value);
	function setReportDetails(details: reportDetails | null) {
		reportDetails.value = details;
	}

	const getSelectedFight = computed(() => getReportDetails.value?.fights?.find(f => f.id === selectedFightID.value) || null);

	function getFightCooldownCacheKey(reportCode: string, fightID: number) {
		return `${reportCode}:${fightID}`;
	}

	function markTimelineWindowFightDataUpdated(reportCode: string, fightID: number) {
		timelineWindowUpdatedFight.value = { reportCode, fightID };
		timelineWindowDataRevision.value++;
	}

	const hasPendingTimelineWindowActions = computed(() => pendingTimelineWindowActions.value.length > 0);

	function flushPendingTimelineWindowActions() {
		if (!timelineWindowActionHandler || pendingTimelineWindowActions.value.length === 0) return;
		const queuedActions = pendingTimelineWindowActions.value;
		pendingTimelineWindowActions.value = [];
		const deferredActions: ReviewTimelineWindowAction[] = [];
		queuedActions.forEach(action => {
			try {
				if (!timelineWindowActionHandler?.(action)) deferredActions.push(action);
			} catch (error) {
				log.error('Failed to handle detached timeline action', { action, error });
				deferredActions.push(action);
			}
		});
		if (deferredActions.length > 0) {
			pendingTimelineWindowActions.value = [
				...deferredActions,
				...pendingTimelineWindowActions.value,
			];
		}
	}

	function registerTimelineWindowActionHandler(handler: TimelineWindowActionHandler) {
		timelineWindowActionHandler = handler;
		flushPendingTimelineWindowActions();
		return () => {
			if (timelineWindowActionHandler === handler) timelineWindowActionHandler = null;
		};
	}

	function receiveTimelineWindowAction(action: ReviewTimelineWindowAction) {
		if (!action?.type) return;
		if (timelineWindowActionHandler) {
			try {
				if (timelineWindowActionHandler(action)) return;
			} catch (error) {
				log.error('Failed to handle detached timeline action', { action, error });
			}
		}
		pendingTimelineWindowActions.value = [
			...pendingTimelineWindowActions.value,
			action,
		].slice(-50);
	}

	function createTimelineWindowDataSnapshot(
		reportCode: string,
		requestedFightIDs?: number[],
	): ReviewTimelineWindowDataSnapshot {
		const cachePrefix = `${reportCode}:`;
		const fightIDs = new Set<number>(
			(requestedFightIDs || []).filter(fightID => Number.isInteger(fightID) && fightID > 0),
		);
		if (!requestedFightIDs) {
			[savedFightEvents.value, savedFightCooldowns.value, savedFightBossCasts.value].forEach(cache => {
				Object.keys(cache).forEach(cacheKey => {
					if (!cacheKey.startsWith(cachePrefix)) return;
					const fightID = Number(cacheKey.slice(cachePrefix.length));
					if (Number.isInteger(fightID) && fightID > 0) fightIDs.add(fightID);
				});
			});
		}

		return {
			reportCode,
			cooldownDataInvalidatedAt: fightCooldownInvalidatedAt || undefined,
			bossCastDataInvalidatedAt: fightBossCastInvalidatedAt || undefined,
			fights: [...fightIDs].map(fightID => {
				const cacheKey = getFightCooldownCacheKey(reportCode, fightID);
				return {
					fightID,
					...(cacheKey in savedFightEvents.value
						? {
							fightEvents: savedFightEvents.value[cacheKey],
							fightEventsCachedAt: fightEventCachedAt.value[cacheKey],
						}
						: {}),
					...(cacheKey in savedFightCooldowns.value
						? {
							cooldownData: savedFightCooldowns.value[cacheKey],
							cooldownDataCachedAt: fightCooldownCachedAt.value[cacheKey],
						}
						: {}),
					...(cacheKey in savedFightBossCasts.value
						? {
							bossCastData: savedFightBossCasts.value[cacheKey],
							bossCastDataCachedAt: fightBossCastCachedAt.value[cacheKey],
						}
						: {}),
				};
			}),
		};
	}

	function getSnapshotCachedAt(value: unknown) {
		return typeof value === 'number' && Number.isFinite(value) && value > 0
			? value
			: 0;
	}

	function mergeTimelineWindowCacheEntry<T>(input: {
		cache: Record<string, T>;
		cachedAt: Record<string, number>;
		cacheKey: string;
		data: T;
		incomingCachedAt: unknown;
		invalidatedAt?: number;
	}) {
		const incomingCachedAt = getSnapshotCachedAt(input.incomingCachedAt);
		const invalidatedAt = input.invalidatedAt || 0;
		const incomingIsFresh = incomingCachedAt > 0 && incomingCachedAt >= invalidatedAt;
		const hasLocalData = Object.prototype.hasOwnProperty.call(input.cache, input.cacheKey);
		const localCachedAt = input.cachedAt[input.cacheKey] || 0;

		// Missing local data may still use an older snapshot as a visible stale value,
		// but it must remain eligible for a network refresh. Existing data is only
		// replaced by a strictly newer snapshot that survived local invalidation.
		if (hasLocalData && (!incomingIsFresh || incomingCachedAt <= localCachedAt)) return false;

		input.cache[input.cacheKey] = input.data;
		if (incomingIsFresh) input.cachedAt[input.cacheKey] = incomingCachedAt;
		else delete input.cachedAt[input.cacheKey];
		return true;
	}

	function mergeTimelineWindowDataSnapshot(snapshot: ReviewTimelineWindowDataSnapshot) {
		if (!snapshot?.reportCode || !Array.isArray(snapshot.fights)) return;
		const incomingCooldownInvalidatedAt = getSnapshotCachedAt(snapshot.cooldownDataInvalidatedAt);
		if (incomingCooldownInvalidatedAt > fightCooldownInvalidatedAt) {
			fightCooldownInvalidatedAt = incomingCooldownInvalidatedAt;
			Object.keys(fightCooldownCachedAt.value).forEach(cacheKey => {
				if (fightCooldownCachedAt.value[cacheKey] < fightCooldownInvalidatedAt) {
					delete fightCooldownCachedAt.value[cacheKey];
				}
			});
		}
		const incomingBossCastInvalidatedAt = getSnapshotCachedAt(snapshot.bossCastDataInvalidatedAt);
		if (incomingBossCastInvalidatedAt > fightBossCastInvalidatedAt) {
			fightBossCastInvalidatedAt = incomingBossCastInvalidatedAt;
			Object.keys(fightBossCastCachedAt.value).forEach(cacheKey => {
				if (fightBossCastCachedAt.value[cacheKey] < fightBossCastInvalidatedAt) {
					delete fightBossCastCachedAt.value[cacheKey];
				}
			});
		}
		snapshot.fights.forEach(fightData => {
			if (!Number.isInteger(fightData?.fightID) || fightData.fightID <= 0) return;
			const cacheKey = getFightCooldownCacheKey(snapshot.reportCode, fightData.fightID);
			if (Array.isArray(fightData.fightEvents)) {
				if (mergeTimelineWindowCacheEntry({
					cache: savedFightEvents.value,
					cachedAt: fightEventCachedAt.value,
					cacheKey,
					data: fightData.fightEvents,
					incomingCachedAt: fightData.fightEventsCachedAt,
				})) fightEventErrors.value[cacheKey] = null;
			}
			if (fightData.cooldownData) {
				if (mergeTimelineWindowCacheEntry({
					cache: savedFightCooldowns.value,
					cachedAt: fightCooldownCachedAt.value,
					cacheKey,
					data: fightData.cooldownData,
					incomingCachedAt: fightData.cooldownDataCachedAt,
					invalidatedAt: fightCooldownInvalidatedAt,
				})) fightCooldownErrors.value[cacheKey] = null;
			}
			if (fightData.bossCastData) {
				const bossCastCachedAt = (
					fightData.bossCastData.interruptsComplete === false
					|| fightData.bossCastData.targetDetailsComplete === false
				)
					? 0
					: fightData.bossCastDataCachedAt;
				if (mergeTimelineWindowCacheEntry({
					cache: savedFightBossCasts.value,
					cachedAt: fightBossCastCachedAt.value,
					cacheKey,
					data: fightData.bossCastData,
					incomingCachedAt: bossCastCachedAt,
					invalidatedAt: fightBossCastInvalidatedAt,
				})) fightBossCastErrors.value[cacheKey] = null;
			}
		});
	}

	async function hydrateTimelineWindowContext(context: ReviewTimelineWindowContext) {
		const generation = ++timelineContextHydrationGeneration;
		timelineContextHydrating = true;
		selectedReportCode.value = context.reportCode;
		reportDetails.value = context.reportDetails;
		selectedFightID.value = context.fightID;
		if (context.dataSnapshot?.reportCode === context.reportCode) {
			mergeTimelineWindowDataSnapshot(context.dataSnapshot);
		}
		await nextTick();
		if (generation === timelineContextHydrationGeneration) timelineContextHydrating = false;
	}

	function getFightEventsFor(reportCode: string, fightID: number) {
		return savedFightEvents.value[getFightCooldownCacheKey(reportCode, fightID)] || [];
	}

	function getFightCooldownDataFor(reportCode: string, fightID: number) {
		return savedFightCooldowns.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function getFightBossCastDataFor(reportCode: string, fightID: number) {
		return savedFightBossCasts.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function isFightEventsLoadingFor(reportCode: string, fightID: number) {
		return Boolean(fightEventRequests.value[getFightCooldownCacheKey(reportCode, fightID)]);
	}

	function getFightEventsErrorFor(reportCode: string, fightID: number) {
		return fightEventErrors.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function isFightCooldownsLoadingFor(reportCode: string, fightID: number) {
		return Boolean(fightCooldownRequests.value[getFightCooldownCacheKey(reportCode, fightID)]);
	}

	function getFightCooldownErrorFor(reportCode: string, fightID: number) {
		return fightCooldownErrors.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function isFightBossCastsLoadingFor(reportCode: string, fightID: number) {
		return Boolean(fightBossCastRequests.value[getFightCooldownCacheKey(reportCode, fightID)]);
	}

	function getFightBossCastErrorFor(reportCode: string, fightID: number) {
		return fightBossCastErrors.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function isFresh(cachedAt: Record<string, number>, cacheKey: string) {
		return Date.now() - (cachedAt[cacheKey] || 0) < FIGHT_DATA_CACHE_TTL_MS;
	}

	const getFightEvents = computed(() => {
		const reportCode = selectedReportCode.value;
		const fightID = selectedFightID.value;
		return reportCode && fightID ? getFightEventsFor(reportCode, fightID) : [];
	});

	const getSelectedFightCooldownCacheKey = computed(() => {
		const reportCode = selectedReportCode.value;
		const fightID = selectedFightID.value;
		if (!reportCode || !fightID) return null;
		return getFightCooldownCacheKey(reportCode, fightID);
	});

	const getFightCooldownData = computed<reviewFightCooldownData | null>(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? savedFightCooldowns.value[cacheKey] || null : null;
	});

	const getFightCooldownEvents = computed(() => getFightCooldownData.value?.fightCooldownEvents || []);
	const getFightCooldownGroups = computed(() => getFightCooldownData.value?.cooldownGroups || []);
	const isFightEventsLoading = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? Boolean(fightEventRequests.value[cacheKey]) : false;
	});
	const getFightEventsError = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? fightEventErrors.value[cacheKey] || null : null;
	});
	const isFightCooldownsLoading = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? Boolean(fightCooldownRequests.value[cacheKey]) : false;
	});
	const getFightCooldownError = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? fightCooldownErrors.value[cacheKey] || null : null;
	});
	const getFightBossCastData = computed<reviewFightBossCastData | null>(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? savedFightBossCasts.value[cacheKey] || null : null;
	});
	const isFightBossCastsLoading = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? Boolean(fightBossCastRequests.value[cacheKey]) : false;
	});
	const getFightBossCastError = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? fightBossCastErrors.value[cacheKey] || null : null;
	});

	function getBossCastPreferenceScope(encounterID: number, difficulty: number) {
		return `${encounterID}:${difficulty}`;
	}

	function parseBossCastVisibilityOverrides(value: unknown): BossCastVisibilityOverrides {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
		const parsed: BossCastVisibilityOverrides = {};
		Object.entries(value).forEach(([scope, overrides]) => {
			if (!scope || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return;
			const scopeOverrides: Record<string, boolean> = {};
			Object.entries(overrides).forEach(([spellID, enabled]) => {
				if (/^\d+$/.test(spellID) && typeof enabled === 'boolean') {
					scopeOverrides[spellID] = enabled;
				}
			});
			parsed[scope] = scopeOverrides;
		});
		return parsed;
	}

	function getPersistableBossCastVisibilityOverrides() {
		// Values stored in a normal ref are deeply wrapped by Vue. Electron IPC cannot
		// structured-clone those proxies, so rebuild a plain object before crossing it.
		return parseBossCastVisibilityOverrides(bossCastVisibilityOverrides.value);
	}

	function ensureBossCastPreferencesLoaded() {
		if (bossCastPreferencesLoaded.value) return Promise.resolve();
		if (bossCastPreferencesPromise) return bossCastPreferencesPromise;
		bossCastPreferencesPromise = (async () => {
			try {
				const [storedOverrides, storedDisplayMode] = await Promise.all([
					store.get(BOSS_CAST_PREFERENCES_STORE_KEY),
					store.get(BOSS_CAST_DISPLAY_MODE_STORE_KEY),
				]);
				bossCastVisibilityOverrides.value = parseBossCastVisibilityOverrides(
					storedOverrides,
				);
				bossCastDisplayMode.value = storedDisplayMode === 'full' ? 'full' : 'collapsed';
			} catch (error) {
				log.error('Failed to load boss cast visibility preferences', error);
				bossCastVisibilityOverrides.value = {};
				bossCastDisplayMode.value = 'collapsed';
			} finally {
				bossCastPreferencesLoaded.value = true;
				bossCastPreferencesPromise = null;
			}
		})();
		return bossCastPreferencesPromise;
	}

	async function reloadBossCastPreferences() {
		if (bossCastPreferencesPromise) await bossCastPreferencesPromise;
		bossCastPreferencesLoaded.value = false;
		bossCastPreferencesPromise = null;
		await ensureBossCastPreferencesLoaded();
	}

	async function setBossCastDisplayMode(mode: BossCastDisplayMode) {
		await ensureBossCastPreferencesLoaded();
		bossCastDisplayMode.value = mode;
		try {
			await store.set(BOSS_CAST_DISPLAY_MODE_STORE_KEY, mode);
		} catch (error) {
			log.error('Failed to persist boss cast display mode', error);
		}
	}

	function isBossCastAbilityEnabled(encounterID: number, difficulty: number, ability: reviewBossCastAbility) {
		const scope = getBossCastPreferenceScope(encounterID, difficulty);
		const override = bossCastVisibilityOverrides.value[scope]?.[String(ability.spellID)];
		return typeof override === 'boolean' ? override : ability.defaultEnabled;
	}

	async function setBossCastAbilityEnabled(encounterID: number, difficulty: number, spellID: number, enabled: boolean) {
		await ensureBossCastPreferencesLoaded();
		const scope = getBossCastPreferenceScope(encounterID, difficulty);
		bossCastVisibilityOverrides.value = {
			...bossCastVisibilityOverrides.value,
			[scope]: {
				...bossCastVisibilityOverrides.value[scope],
				[String(spellID)]: enabled,
			},
		};
		try {
			await store.set(BOSS_CAST_PREFERENCES_STORE_KEY, getPersistableBossCastVisibilityOverrides());
		} catch (error) {
			log.error('Failed to persist boss cast visibility preferences', error);
		}
	}

	async function resetBossCastAbilityPreferences(encounterID: number, difficulty: number) {
		await ensureBossCastPreferencesLoaded();
		const scope = getBossCastPreferenceScope(encounterID, difficulty);
		bossCastVisibilityOverrides.value = Object.fromEntries(
			Object.entries(bossCastVisibilityOverrides.value).filter(([key]) => key !== scope),
		);
		try {
			await store.set(BOSS_CAST_PREFERENCES_STORE_KEY, getPersistableBossCastVisibilityOverrides());
		} catch (error) {
			log.error('Failed to reset boss cast visibility preferences', error);
		}
	}

	const getReportTimeOffset = computed(() => {
		const selected = getSelectedReport.value;
		if (!selected) return 0;
		return selected.startTime;
	});

	const getFightStartTimeOffset = computed(() => {
		const selected = getSelectedFight.value;
		if (!selected) return 0;
		return selected.startTime;
	});

	const getFightStartTime = computed(() => {
		const offset = getReportTimeOffset.value;
		const fightOffset = getFightStartTimeOffset.value;
		return offset + fightOffset;
	});

	const getFightStartRelativeToVideo = computed(() => {
		const videoStart = selectedVideoInfo.value?.startTime || 0;
		const fightStart = getFightStartTime.value || 0;
		return fightStart - videoStart;
	});

	const getFightDuration = computed(() => {
		const selected = getSelectedFight.value;
		if (!selected) return 0;
		return selected.endTime - selected.startTime;
	});

	async function requestReports(endTime?: number) {
		// log.info(`Requesting WCL reports, endtime: ${endTime}`);
		let reports = await ipc.invoke(IPC_EVENTS.WCL_REQUEST_REPORTS_LIST, { endTime });
		// prepend older reports to the existing list

		const newReports = [...getReports.value];
		for (const report of reports) {
			const existingIndex = newReports.findIndex(r => r.code === report.code);
			if (existingIndex >= 0) {
				newReports[existingIndex] = report;
			} else {
				newReports.push(report);
			}
		}

		newReports.sort((a, b) => b.startTime - a.startTime); // sort by start time descending

		// log.info('Received WCL reports');
		setReports(newReports);
	}

	async function requestReportData() {
		const selected = getSelectedReport.value;
		if (!selected) return;
		const reportCode = selected.code;

		const reportData = await ipc.invoke(IPC_EVENTS.WCL_REQUEST_REPORT_DATA, { reportCode });
		// sort fights by start time
		reportData.fights?.sort((a: fightDetails, b: fightDetails) => b.startTime - a.startTime);

		setReportDetails(reportData);
	}

	async function ensureFightEvents(reportCode: string, fightID: number, force = false, encounterID?: number): Promise<fightEvent[]> {
		const cacheKey = getFightCooldownCacheKey(reportCode, fightID);
		const cached = savedFightEvents.value[cacheKey];
		if (!force && cached && isFresh(fightEventCachedAt.value, cacheKey)) return cached;

		const pending = fightEventPromises.get(cacheKey);
		if (pending) return pending;

		fightEventRequests.value[cacheKey] = true;
		fightEventErrors.value[cacheKey] = null;
		const requestEpoch = fightEventRequestEpoch;
		const request = (async () => {
			try {
				const response = await ipc.invoke(
					IPC_EVENTS.WCL_REQUEST_FIGHT_EVENTS,
					{ reportCode, fightID, encounterID },
				) as reviewFightEventsResponse;
				if (response.error) throw new Error(response.error);
				if (requestEpoch !== fightEventRequestEpoch) {
					return savedFightEvents.value[cacheKey] || response.fightEvents || [];
				}
				savedFightEvents.value[cacheKey] = response.fightEvents || [];
				fightEventCachedAt.value[cacheKey] = Date.now();
				markTimelineWindowFightDataUpdated(reportCode, fightID);
				return savedFightEvents.value[cacheKey];
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to request fight events';
				if (requestEpoch === fightEventRequestEpoch) fightEventErrors.value[cacheKey] = message;
				log.error('Failed to request WCL fight events', { reportCode, fightID, error });
				return savedFightEvents.value[cacheKey] || [];
			} finally {
				if (fightEventPromises.get(cacheKey) === request) {
					fightEventRequests.value[cacheKey] = false;
					fightEventPromises.delete(cacheKey);
				}
			}
		})();
		fightEventPromises.set(cacheKey, request);
		return request;
	}

	async function ensureFightCooldowns(reportCode: string, fightID: number, force = false): Promise<reviewFightCooldownData> {
		const cacheKey = getFightCooldownCacheKey(reportCode, fightID);
		const cached = savedFightCooldowns.value[cacheKey];
		if (!force && cached && isFresh(fightCooldownCachedAt.value, cacheKey)) return cached;

		const pending = fightCooldownPromises.get(cacheKey);
		if (pending) return pending;

		fightCooldownRequests.value[cacheKey] = true;
		fightCooldownErrors.value[cacheKey] = null;
		const requestEpoch = fightCooldownRequestEpoch;
		const request = (async () => {
			try {
				const response = await ipc.invoke(
					IPC_EVENTS.WCL_REQUEST_FIGHT_COOLDOWNS,
					{ reportCode, fightID },
				) as reviewFightCooldownResponse;

				if (response.error) throw new Error(response.error);

				const data: reviewFightCooldownData = {
					catalogVersion: response.catalogVersion || 0,
					cooldownGroups: response.cooldownGroups || [],
					fightCooldownEvents: response.fightCooldownEvents || [],
				};
				if (requestEpoch !== fightCooldownRequestEpoch) {
					return savedFightCooldowns.value[cacheKey] || data;
				}
				savedFightCooldowns.value[cacheKey] = data;
				fightCooldownCachedAt.value[cacheKey] = Date.now();
				markTimelineWindowFightDataUpdated(reportCode, fightID);
				return data;
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to request fight cooldowns';
				if (requestEpoch === fightCooldownRequestEpoch) {
					fightCooldownErrors.value[cacheKey] = message;
				}
				log.error('Failed to request WCL fight cooldowns', { reportCode, fightID, error });
				return savedFightCooldowns.value[cacheKey] || {
					catalogVersion: 0,
					cooldownGroups: [],
					fightCooldownEvents: [],
				};
			}
		})();
		fightCooldownPromises.set(cacheKey, request);
		void request.finally(() => {
			if (fightCooldownPromises.get(cacheKey) !== request) return;
			fightCooldownRequests.value[cacheKey] = false;
			fightCooldownPromises.delete(cacheKey);
		});
		return request;
	}

	async function ensureFightBossCasts(
		reportCode: string,
		fightID: number,
		force = false,
		encounterID?: number,
	): Promise<reviewFightBossCastData> {
		const cacheKey = getFightCooldownCacheKey(reportCode, fightID);
		const cached = savedFightBossCasts.value[cacheKey];
		if (!force && cached && isFresh(fightBossCastCachedAt.value, cacheKey)) return cached;
		const pending = fightBossCastPromises.get(cacheKey);
		if (pending) return pending;

		fightBossCastRequests.value[cacheKey] = true;
		fightBossCastErrors.value[cacheKey] = null;
		const requestEpoch = fightBossCastRequestEpoch;
		const request = (async () => {
			try {
				const response = await ipc.invoke(
					IPC_EVENTS.WCL_REQUEST_FIGHT_BOSS_CASTS,
					{ reportCode, fightID, encounterID },
				) as reviewFightBossCastResponse;
				if (response.error || !response.bossCastData) {
					throw new Error(response.error || 'Failed to request fight boss casts');
				}
				if (requestEpoch !== fightBossCastRequestEpoch) {
					return savedFightBossCasts.value[cacheKey] || response.bossCastData;
				}
				if (
					response.bossCastData.interruptsComplete === false
					|| response.bossCastData.targetDetailsComplete === false
				) {
					if (
						cached
						&& cached.interruptsComplete !== false
						&& cached.targetDetailsComplete !== false
					) return cached;
					savedFightBossCasts.value[cacheKey] = response.bossCastData;
					delete fightBossCastCachedAt.value[cacheKey];
					markTimelineWindowFightDataUpdated(reportCode, fightID);
					return response.bossCastData;
				}
				savedFightBossCasts.value[cacheKey] = response.bossCastData;
				fightBossCastCachedAt.value[cacheKey] = Date.now();
				markTimelineWindowFightDataUpdated(reportCode, fightID);
				return response.bossCastData;
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to request fight boss casts';
				if (requestEpoch === fightBossCastRequestEpoch) fightBossCastErrors.value[cacheKey] = message;
				log.error('Failed to request WCL fight boss casts', { reportCode, fightID, error });
				return savedFightBossCasts.value[cacheKey] || { fightID, abilities: [], bossCastEvents: [] };
			}
		})();
		fightBossCastPromises.set(cacheKey, request);
		void request.finally(() => {
			if (fightBossCastPromises.get(cacheKey) !== request) return;
			fightBossCastRequests.value[cacheKey] = false;
			fightBossCastPromises.delete(cacheKey);
		});
		return request;
	}

	async function requestFightEvents(force = false) {
		const reportCode = selectedReportCode.value;
		const fightID = selectedFightID.value;
		if (!reportCode || !fightID) return [];
		return ensureFightEvents(reportCode, fightID, force, getSelectedFight.value?.encounterID);
	}

	async function requestFightCooldowns(force = false) {
		const reportCode = selectedReportCode.value;
		const fightID = selectedFightID.value;
		if (!reportCode || !fightID) return null;
		return ensureFightCooldowns(reportCode, fightID, force);
	}

	async function requestFightBossCasts(force = false) {
		const reportCode = selectedReportCode.value;
		const fightID = selectedFightID.value;
		const encounterID = getSelectedFight.value?.encounterID;
		if (!reportCode || !fightID || !encounterID) return null;
		return ensureFightBossCasts(reportCode, fightID, force, encounterID);
	}

	const videoList = computed<YouTubeVideo[]>(() => {
		const reportTimeOffset = getReportTimeOffset.value || Date.now();
		log.info('Calculating video list with report time offset:', reportTimeOffset);
		const fightStartTime = reportTimeOffset + (getSelectedFight.value?.startTime || 0);
		const fightEndTime = reportTimeOffset + (getSelectedFight.value?.endTime || 0);

		const videosArray: YouTubeVideo[] = Object.values(youtubeVideoInfo.value.byId || {});

		// if no specific fight selected just check streams that were active when report started
		return videosArray.filter((video) => {
			// If duration is 0, treat as "still live" (endTime = now + 12 hours)
			const videoEnd = video.duration === 0
				? Date.now() + TWELVE_HOURS_MS
				: video.startTime + video.duration;

			// log.info(`Video ${video.id} ${video.title} (${video.author}) from ${new Date(video.startTime).toLocaleString()} to ${new Date(videoEnd).toLocaleString()} checkTime: ${new Date(video.checkTime).toLocaleString()}}	`);
			// log.info(video.startTim	e,
			// 	videoEnd,
			// 	fightEndTime,
			// 	fightStartTime,
			// 	(video.startTime <= fightEndTime) && (videoEnd >= fightStartTime),
			// 	video.startTime <= fightEndTime,
			// 	videoEnd >= fightStartTime
			// );
			// Check if video overlaps with fight time
			return !selectedReportCode.value || ((video.startTime <= fightEndTime) && (videoEnd >= fightStartTime));
		}).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
	});

	async function openVideoFromDeepLink(videoId: string, timestampSeconds: number) {
		const normalizedVideoId = videoId.trim();
		if (!normalizedVideoId) {
			return { success: false, error: 'Deep link is missing a video ID.' };
		}

		await refreshYoutubeVideoInfo(); // ensure we have the latest video info before trying to find the video

		const targetVideo = youtubeVideoInfo.value?.byId?.[normalizedVideoId] ?? null;
		if (!targetVideo) {
			return { success: false, error: `Video ${normalizedVideoId} was not found.` };
		}

		// if video was active during currently selected report/fight just select it and set the timestamp
		// otherwise clear selected report/fight to avoid confusion and then select the video and set the timestamp

		if (selectedReportCode.value && !videoList.value.some(v => v.id === normalizedVideoId)) {
			log.info('Deep linked video is not relevant to currently selected report/fight, clearing selection');
			selectedFightID.value = null;

			if (selectedReportCode.value !== null) {
				selectedReportCode.value = null;
				reportDetails.value = null;
				await nextTick();
			}
		}

		setSelectedVideoInfo(targetVideo);
		pendingDirectVideoSeekSeconds.value = timestampSeconds;
		log.info('Opened video from deep link', { videoId: normalizedVideoId, timestampSeconds });

		return { success: true };
	}

	watch(selectedReportCode, async (newVal, oldVal) => {
		if (timelineContextHydrating) return;
		if (newVal !== oldVal) {
			selectedFightID.value = null; // reset selected fight
			await nextTick(); // wait for videoList to update based on new report selection
			if (newVal && videoList.value.length > 0 && !videoList.value.some(v => v.id === selectedVideoInfo.value?.id)) {
				setSelectedVideoInfo(videoList.value[0] || null); // auto-select first video if current selection is not relevant to new report
			}
			log.info('Selected report changed:', newVal);
			requestReportData();
		}
	});

	watch(selectedFightID, (newVal, oldVal) => {
		if (timelineContextHydrating) return;
		if (newVal !== oldVal) {
			void requestFightEvents();
			void requestFightCooldowns();
		}
	});

	ipc.on(IPC_EVENTS.SOCKET_WCL_READY_CALLBACK, () => {
		// A reconnect can mean the server was deployed with a new cooldown catalog,
		// encounter-alert registry, or boss-cast enrichment. Wait until this socket's
		// WCL credentials are restored before invalidating and refreshing; otherwise
		// the first request can fail and leave the old visible fallback in place.
		const invalidatedAt = Date.now();
		fightCooldownInvalidatedAt = invalidatedAt;
		fightBossCastInvalidatedAt = invalidatedAt;
		fightEventCachedAt.value = {};
		fightEventRequests.value = {};
		fightEventErrors.value = {};
		fightEventRequestEpoch++;
		fightEventPromises.clear();
		fightCooldownCachedAt.value = {};
		fightCooldownRequests.value = {};
		fightCooldownErrors.value = {};
		fightCooldownRequestEpoch++;
		fightCooldownPromises.clear();
		fightCooldownCacheEpoch.value++;
		fightBossCastCachedAt.value = {};
		fightBossCastRequests.value = {};
		fightBossCastErrors.value = {};
		fightBossCastRequestEpoch++;
		fightBossCastPromises.clear();
		fightBossCastCacheEpoch.value++;

		const reportCode = selectedReportCode.value;
		const fightID = selectedFightID.value;
		if (!reportCode || !fightID) return;

		void ensureFightEvents(reportCode, fightID, true, getSelectedFight.value?.encounterID);
		void ensureFightCooldowns(reportCode, fightID, true);
		void ensureFightBossCasts(reportCode, fightID, true, getSelectedFight.value?.encounterID);
	});

	ipc.on(IPC_EVENTS.TIMELINE_WINDOW_ACTION, (_event, action: ReviewTimelineWindowAction) => {
		receiveTimelineWindowAction(action);
	});

	ipc.on(
		IPC_EVENTS.TIMELINE_WINDOW_REATTACHED,
		(_event, input?: { returnToReviews?: boolean }) => {
			timelineWindowDetached.value = false;
			timelineExpanded.value = true;
			void reloadBossCastPreferences();
			if (input?.returnToReviews) timelineWindowReturnToReviewsRevision.value++;
		},
	);

	ipc.on(
		IPC_EVENTS.TIMELINE_WINDOW_DATA_UPDATED,
		(_event, snapshot: ReviewTimelineWindowDataSnapshot) => {
			mergeTimelineWindowDataSnapshot(snapshot);
		},
	);

	return {
		youtubeVideoInfo,
		selectedVideoInfo,
		pendingDirectVideoSeekSeconds,
		timelineWindowDetached,
		timelineExpanded,
		timelineViewMode,
		timelineWindowReturnToReviewsRevision,
		timelineWindowDataRevision,
		timelineWindowUpdatedFight,
		hasPendingTimelineWindowActions,
		reports,
		selectedReportCode,
		reportDetails,
		selectedFightID,
		savedFightEvents,
		savedFightCooldowns,
		savedFightBossCasts,
		fightCooldownCacheEpoch,
		fightBossCastCacheEpoch,
		bossCastVisibilityOverrides,
		bossCastDisplayMode,
		bossCastPreferencesLoaded,
		videoList,

		getReports,
		setReports,

		getSelectedVideoId,
		setSelectedVideoInfo,
		consumePendingDirectVideoSeekSeconds,
		getSelectedReport,
		getReportDetails,
		setReportDetails,
		getSelectedFight,
		getFightEvents,
		getFightEventsFor,
		isFightEventsLoading,
		isFightEventsLoadingFor,
		getFightEventsError,
		getFightEventsErrorFor,
		getFightCooldownData,
		getFightCooldownDataFor,
		getFightCooldownEvents,
		getFightCooldownGroups,
		isFightCooldownsLoading,
		isFightCooldownsLoadingFor,
		getFightCooldownError,
		getFightCooldownErrorFor,
		getFightBossCastData,
		getFightBossCastDataFor,
		isFightBossCastsLoading,
		isFightBossCastsLoadingFor,
		getFightBossCastError,
		getFightBossCastErrorFor,
		getReportTimeOffset,
		getFightStartTimeOffset,
		getFightStartTime,
		getFightStartRelativeToVideo,
		getFightDuration,
		hydrateTimelineWindowContext,
		createTimelineWindowDataSnapshot,
		registerTimelineWindowActionHandler,
		flushPendingTimelineWindowActions,

		requestReports,
		requestReportData,
		requestFightEvents,
		requestFightCooldowns,
		requestFightBossCasts,
		ensureFightEvents,
		ensureFightCooldowns,
		ensureFightBossCasts,
		ensureBossCastPreferencesLoaded,
		reloadBossCastPreferences,
		setBossCastDisplayMode,
		isBossCastAbilityEnabled,
		setBossCastAbilityEnabled,
		resetBossCastAbilityPreferences,
		openVideoFromDeepLink,
	};
});
