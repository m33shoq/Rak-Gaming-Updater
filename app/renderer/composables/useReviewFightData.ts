import log from 'electron-log/renderer';
import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue';

import { IPC_EVENTS } from '@/events';
import { REVIEW_REPLAY_VERSION, type FightReplayData } from '@/replay';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import type { ReviewTimelineWindowDataSnapshot } from '@/timelineWindow';
import type { WclRequestResult } from '@/wclRequests';

const FIGHT_DATA_CACHE_TTL_MS = 30 * 60 * 1000;
const FIGHT_REPLAY_CACHE_LIMIT = 8;

type ReviewFightDataOptions = {
	selectedReportCode: Ref<string | null>;
	selectedFightID: Ref<number | null>;
	selectedFight: ComputedRef<fightDetails | null>;
};

export function useReviewFightData(options: ReviewFightDataOptions) {
	const timelineWindowDataRevision = ref(0);
	const timelineWindowUpdatedFight = shallowRef<{ reportCode: string; fightID: number } | null>(null);
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
	// Replay payloads contain thousands of position objects. Keep them shallow so
	// Vue does not recursively proxy immutable WCL data every time the view opens.
	const savedFightReplays = shallowRef<Record<string, FightReplayData>>({});
	const fightReplayCachedAt = ref<Record<string, number>>({});
	const fightReplayRequests = ref<Record<string, boolean>>({});
	const fightReplayErrors = ref<Record<string, string | null>>({});
	const fightEventPromises = new Map<string, Promise<fightEvent[]>>();
	const fightCooldownPromises = new Map<string, Promise<reviewFightCooldownData>>();
	const fightBossCastPromises = new Map<string, Promise<reviewFightBossCastData>>();
	const fightReplayPromises = new Map<string, Promise<FightReplayData | null>>();
	let fightEventRequestEpoch = 0;
	let fightCooldownRequestEpoch = 0;
	let fightBossCastRequestEpoch = 0;
	let fightReplayRequestEpoch = 0;
	let fightCooldownInvalidatedAt = 0;
	let fightBossCastInvalidatedAt = 0;

	function getFightCooldownCacheKey(reportCode: string, fightID: number) {
		return `${reportCode}:${fightID}`;
	}

	function markTimelineWindowFightDataUpdated(reportCode: string, fightID: number) {
		timelineWindowUpdatedFight.value = { reportCode, fightID };
		timelineWindowDataRevision.value++;
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

	function getFightEventsFor(reportCode: string, fightID: number) {
		return savedFightEvents.value[getFightCooldownCacheKey(reportCode, fightID)] || [];
	}

	function getFightCooldownDataFor(reportCode: string, fightID: number) {
		return savedFightCooldowns.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function getFightBossCastDataFor(reportCode: string, fightID: number) {
		return savedFightBossCasts.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function getFightReplayDataFor(reportCode: string, fightID: number) {
		return savedFightReplays.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
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

	function isFightReplayLoadingFor(reportCode: string, fightID: number) {
		return Boolean(fightReplayRequests.value[getFightCooldownCacheKey(reportCode, fightID)]);
	}

	function getFightReplayErrorFor(reportCode: string, fightID: number) {
		return fightReplayErrors.value[getFightCooldownCacheKey(reportCode, fightID)] || null;
	}

	function isFresh(cachedAt: Record<string, number>, cacheKey: string) {
		return Date.now() - (cachedAt[cacheKey] || 0) < FIGHT_DATA_CACHE_TTL_MS;
	}

	const getFightEvents = computed(() => {
		const reportCode = options.selectedReportCode.value;
		const fightID = options.selectedFightID.value;
		return reportCode && fightID ? getFightEventsFor(reportCode, fightID) : [];
	});

	const getSelectedFightCooldownCacheKey = computed(() => {
		const reportCode = options.selectedReportCode.value;
		const fightID = options.selectedFightID.value;
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
	const getFightReplayData = computed<FightReplayData | null>(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? savedFightReplays.value[cacheKey] || null : null;
	});
	const isFightReplayLoading = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? Boolean(fightReplayRequests.value[cacheKey]) : false;
	});
	const getFightReplayError = computed(() => {
		const cacheKey = getSelectedFightCooldownCacheKey.value;
		return cacheKey ? fightReplayErrors.value[cacheKey] || null : null;
	});

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
				) as WclRequestResult<fightEvent[]>;
				if (!response || response.success !== true) {
					throw new Error(
						response && 'error' in response ? response.error : 'Failed to request fight events',
					);
				}
				if (requestEpoch !== fightEventRequestEpoch) {
					return savedFightEvents.value[cacheKey] || response.data;
				}
				savedFightEvents.value[cacheKey] = response.data;
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
				) as WclRequestResult<reviewFightCooldownData>;

				if (!response || response.success !== true) {
					throw new Error(
						response && 'error' in response ? response.error : 'Failed to request fight cooldowns',
					);
				}

				const data = response.data;
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
				) as WclRequestResult<reviewFightBossCastData>;
				if (!response || response.success !== true) {
					throw new Error(
						response && 'error' in response ? response.error : 'Failed to request fight boss casts',
					);
				}
				const bossCastData = response.data;
				if (requestEpoch !== fightBossCastRequestEpoch) {
					return savedFightBossCasts.value[cacheKey] || bossCastData;
				}
				if (
					bossCastData.interruptsComplete === false
					|| bossCastData.targetDetailsComplete === false
				) {
					if (
						cached
						&& cached.interruptsComplete !== false
						&& cached.targetDetailsComplete !== false
					) return cached;
					savedFightBossCasts.value[cacheKey] = bossCastData;
					delete fightBossCastCachedAt.value[cacheKey];
					markTimelineWindowFightDataUpdated(reportCode, fightID);
					return bossCastData;
				}
				savedFightBossCasts.value[cacheKey] = bossCastData;
				fightBossCastCachedAt.value[cacheKey] = Date.now();
				markTimelineWindowFightDataUpdated(reportCode, fightID);
				return bossCastData;
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

	async function ensureFightReplay(
		reportCode: string,
		fightID: number,
		force = false,
	): Promise<FightReplayData | null> {
		const cacheKey = getFightCooldownCacheKey(reportCode, fightID);
		const cached = savedFightReplays.value[cacheKey];
		if (!force && cached && isFresh(fightReplayCachedAt.value, cacheKey)) return cached;

		const pending = fightReplayPromises.get(cacheKey);
		if (pending) return pending;

		fightReplayRequests.value[cacheKey] = true;
		fightReplayErrors.value[cacheKey] = null;
		const requestEpoch = fightReplayRequestEpoch;
		const request = (async () => {
			try {
				const response = await ipc.invoke(
					IPC_EVENTS.WCL_REQUEST_FIGHT_REPLAY,
					{ reportCode, fightID, force },
				) as WclRequestResult<FightReplayData>;
				const replay = response && response.success === true ? response.data : null;
				if (
					!replay
					|| replay.version !== REVIEW_REPLAY_VERSION
					|| typeof replay.enrichmentComplete !== 'boolean'
					|| !Array.isArray(replay.actors)
					|| !Array.isArray(replay.casts)
					|| !Array.isArray(replay.uiMapIDs)
					|| !Array.isArray(replay.overlays)
				) {
					throw new Error(
						response && response.success === false
							? response.error
							: 'Replay data is unavailable',
					);
				}
				if (requestEpoch !== fightReplayRequestEpoch) {
					return savedFightReplays.value[cacheKey] || replay;
				}
				const nextReplays = { ...savedFightReplays.value };
				// Reinsert the entry so object order acts as a small LRU. Replay payloads
				// are considerably larger than the other fight-data responses.
				delete nextReplays[cacheKey];
				nextReplays[cacheKey] = replay;
				while (Object.keys(nextReplays).length > FIGHT_REPLAY_CACHE_LIMIT) {
					const oldestKey = Object.keys(nextReplays)[0];
					delete nextReplays[oldestKey];
					delete fightReplayCachedAt.value[oldestKey];
					delete fightReplayErrors.value[oldestKey];
				}
				savedFightReplays.value = nextReplays;
				if (replay.enrichmentComplete) fightReplayCachedAt.value[cacheKey] = Date.now();
				else delete fightReplayCachedAt.value[cacheKey];
				return replay;
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to request fight replay';
				if (requestEpoch === fightReplayRequestEpoch) fightReplayErrors.value[cacheKey] = message;
				log.error('Failed to request WCL fight replay', { reportCode, fightID, error });
				return savedFightReplays.value[cacheKey] || null;
			}
		})();
		fightReplayPromises.set(cacheKey, request);
		void request.finally(() => {
			if (fightReplayPromises.get(cacheKey) !== request) return;
			fightReplayRequests.value[cacheKey] = false;
			fightReplayPromises.delete(cacheKey);
		});
		return request;
	}

	async function requestFightEvents(force = false) {
		const reportCode = options.selectedReportCode.value;
		const fightID = options.selectedFightID.value;
		if (!reportCode || !fightID) return [];
		return ensureFightEvents(reportCode, fightID, force, options.selectedFight.value?.encounterID);
	}

	async function requestFightCooldowns(force = false) {
		const reportCode = options.selectedReportCode.value;
		const fightID = options.selectedFightID.value;
		if (!reportCode || !fightID) return null;
		return ensureFightCooldowns(reportCode, fightID, force);
	}

	async function requestFightBossCasts(force = false) {
		const reportCode = options.selectedReportCode.value;
		const fightID = options.selectedFightID.value;
		const encounterID = options.selectedFight.value?.encounterID;
		if (!reportCode || !fightID || !encounterID) return null;
		return ensureFightBossCasts(reportCode, fightID, force, encounterID);
	}

	function invalidate(): void {
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
		fightReplayCachedAt.value = {};
		fightReplayRequests.value = {};
		fightReplayErrors.value = {};
		fightReplayRequestEpoch++;
		fightReplayPromises.clear();
	}

	useIpcOn(
		IPC_EVENTS.TIMELINE_WINDOW_DATA_UPDATED,
		(_event, snapshot: ReviewTimelineWindowDataSnapshot) => {
			mergeTimelineWindowDataSnapshot(snapshot);
		},
	);

	return {
		createTimelineWindowDataSnapshot,
		ensureFightBossCasts,
		ensureFightCooldowns,
		ensureFightEvents,
		ensureFightReplay,
		fightBossCastCacheEpoch,
		fightCooldownCacheEpoch,
		getFightBossCastData,
		getFightBossCastDataFor,
		getFightBossCastError,
		getFightBossCastErrorFor,
		getFightCooldownData,
		getFightCooldownDataFor,
		getFightCooldownError,
		getFightCooldownErrorFor,
		getFightCooldownEvents,
		getFightCooldownGroups,
		getFightEvents,
		getFightEventsError,
		getFightEventsErrorFor,
		getFightEventsFor,
		getFightReplayData,
		getFightReplayDataFor,
		getFightReplayError,
		getFightReplayErrorFor,
		invalidate,
		isFightBossCastsLoading,
		isFightBossCastsLoadingFor,
		isFightCooldownsLoading,
		isFightCooldownsLoadingFor,
		isFightEventsLoading,
		isFightEventsLoadingFor,
		isFightReplayLoading,
		isFightReplayLoadingFor,
		mergeTimelineWindowDataSnapshot,
		requestFightBossCasts,
		requestFightCooldowns,
		requestFightEvents,
		savedFightBossCasts,
		savedFightCooldowns,
		savedFightEvents,
		savedFightReplays,
		timelineWindowDataRevision,
		timelineWindowUpdatedFight,
	};
}
