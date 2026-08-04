<script setup lang="ts">
import log from 'electron-log/renderer';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import ReviewCooldownTarget from '@/renderer/components/ReviewCooldownTarget.vue';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';

const props = defineProps<{
	groups: reviewCooldownGroup[];
	enabledGroupIds: reviewCooldownGroupID[];
	excludedSpellIds: number[];
	currentFightCursorSeconds: number;
	requestedPlayerId?: number;
	requestedPlayerName?: string;
	playerRequestToken?: number;
}>();

const emit = defineEmits<{
	spellEventsChange: [events: reviewCooldownEvent[]];
	playerRequestApplied: [token: number];
	seekPull: [fightID: number, timestampSeconds: number];
	openPull: [fightID: number];
	openDeath: [fightID: number, deathID: number];
}>();

type SortMode = 'chronological' | 'duration';
type SortDirection = 'desc' | 'asc';
type PlayerRole = 'tank' | 'healer' | 'dps' | 'unknown';
type StoredPlayerSelections = Record<string, number>;
type StoredComparisonPreferences = {
	sortMode: SortMode;
	sortDirection: SortDirection;
	alignmentPhaseKeys: Record<string, string>;
};
type PlayerOption = {
	id: number;
	name: string;
	className: string;
	spec: string;
	actorIcon: string;
	role: PlayerRole;
};
type PhaseTime = {
	key: string;
	name: string;
	occurrence: number;
	timestampSeconds: number;
};
type PhaseMarker = PhaseTime & {
	percent: number;
};
type CooldownMarker = { event: reviewCooldownEvent; timestampSeconds: number; percent: number; track: number; key: string };
type DeathPeriod = {
	id: number;
	key: string;
	event: fightEvent;
	resurrectionEvent?: fightEvent;
	resurrectionKind?: 'player' | 'reincarnation';
	timestampSeconds: number;
	endTimestampSeconds: number;
	percent: number;
	endPercent: number;
	spell: string;
	icon: string;
	resurrected: boolean;
};
type PullRow = {
	fight: fightDetails;
	pullNumber: number;
	durationSeconds: number;
	isAligned: boolean;
	startPercent: number;
	endPercent: number;
	actorIcon: string;
	phases: PhaseMarker[];
	cooldowns: CooldownMarker[];
	deaths: DeathPeriod[];
	height: number;
};
type DetailTooltip =
	| { kind: 'cooldown'; row: PullRow; marker: CooldownMarker; x: number; y: number }
	| { kind: 'death'; row: PullRow; death: DeathPeriod; x: number; y: number }
	| { kind: 'phase'; row: PullRow; phase: PhaseMarker; deltaSeconds: number | null; x: number; y: number };

const ROLE_SORT_ORDER: Record<PlayerRole, number> = { tank: 0, healer: 1, dps: 2, unknown: 3 };
const ROLE_LABELS: Record<PlayerRole, string> = { tank: 'Tank', healer: 'Healer', dps: 'Damage', unknown: 'Other' };
const TANK_SPECS = new Set(['blood', 'brewmaster', 'guardian', 'protection', 'vengeance']);
const HEALER_SPECS = new Set(['discipline', 'holy', 'mistweaver', 'preservation', 'restoration']);
const PLAYER_SELECTION_STORE_KEY = 'reviewCooldownComparisonPlayerSelections';
const COMPARISON_PREFERENCES_STORE_KEY = 'reviewCooldownComparisonPreferences';
const INITIAL_PULL_LIMIT = 8;
const PULL_LOAD_BATCH_SIZE = 8;
const AUTO_LOAD_THRESHOLD_PX = 160;
const AUTO_LOAD_THROTTLE_MS = 250;

const reviewsStore = useReviewsStore();
const anchorReportCode = ref(reviewsStore.selectedReportCode);
const anchorFightID = ref(reviewsStore.selectedFightID);
const selectedPlayerID = ref<number | null>(null);
const storedPlayerSelections = ref<StoredPlayerSelections>({});
const playerSelectionsLoaded = ref(false);
const storedAlignmentPhaseKeys = ref<Record<string, string>>({});
const comparisonPreferencesLoaded = ref(false);
const visiblePullLimit = ref(INITIAL_PULL_LIMIT);
const sortMode = ref<SortMode>('chronological');
const sortDirection = ref<SortDirection>('desc');
const alignmentPhaseKey = ref('');
const hoveredPhaseKey = ref<string | null>(null);
const timelineHover = ref({ visible: false, percent: 0, timestampSeconds: 0 });
const detailTooltip = ref<DetailTooltip | null>(null);
const playerPicker = ref<HTMLElement | null>(null);
const isPlayerPickerOpen = ref(false);
const scroller = ref<HTMLElement | null>(null);
const scrollbarTrack = ref<HTMLElement | null>(null);
const scrollbar = ref({ visible: false, active: false, thumbHeight: 0, thumbTop: 0, maxScroll: 0 });
let autoLoadPending = false;
let lastAutoLoadAt = Number.NEGATIVE_INFINITY;
let pendingPlayerRosterValidationFightID: number | null = reviewsStore.selectedFightID;
const enabledGroupIDSet = computed(() => new Set(props.enabledGroupIds));
const excludedSpellIDSet = computed(() => new Set(props.excludedSpellIds));
const reportDetails = computed(() => reviewsStore.getReportDetails);
const anchorFight = computed(() => reportDetails.value?.fights.find(fight => fight.id === anchorFightID.value) || null);
const playerSelectionScopeKey = computed(() => {
	const reportCode = anchorReportCode.value;
	const fight = anchorFight.value;
	return reportCode && fight
		? `${reportCode}:${fight.encounterID}:${fight.difficulty}`
		: null;
});
const actorByID = computed(() => new Map(
	(reportDetails.value?.masterData?.actors || []).map(actor => [actor.id, actor]),
));
const playerOptions = computed<PlayerOption[]>(() => {
	const matchingFights = (reportDetails.value?.fights || [])
		.filter(fightMatchesAnchor)
		.sort((left, right) => right.startTime - left.startTime);
	const friendlyPlayerIDs = new Set(matchingFights.flatMap(fight => fight.friendlyPlayers || []));

	return [...friendlyPlayerIDs]
		.map((playerID): PlayerOption | null => {
			const actor = actorByID.value.get(playerID);
			if (!actor?.id || !actor.name) return null;
			const latestFight = matchingFights.find(fight => (fight.friendlyPlayers || []).includes(playerID));
			const playerIndex = latestFight?.friendlyPlayers?.indexOf(playerID) ?? -1;
			const spec = playerIndex >= 0 ? latestFight?.friendlySpecs?.[playerIndex] || '' : '';
			const className = actor.subType || actor.type || '';

			return {
				id: actor.id,
				name: actor.name,
				className,
				spec,
				actorIcon: className && spec ? `${className}-${spec.replace(/\s+/g, '')}` : '',
				role: getPlayerRole(spec),
			};
		})
		.filter((player): player is PlayerOption => player != null)
		.sort((left, right) => (
			ROLE_SORT_ORDER[left.role] - ROLE_SORT_ORDER[right.role]
			|| left.className.localeCompare(right.className)
			|| left.name.localeCompare(right.name)
		));
});
const selectedPlayerOption = computed(() => (
	playerOptions.value.find(player => player.id === selectedPlayerID.value) || null
));

watch(
	[
		() => reviewsStore.selectedReportCode,
		() => reviewsStore.selectedFightID,
		reportDetails,
	],
	([reportCode, fightID]) => {
		if (!reportCode || !fightID) return;
		const nextFight = reportDetails.value?.fights.find(fight => fight.id === fightID);
		if (!nextFight) return;

		const currentAnchor = anchorFight.value;
		const shouldReanchor = reportCode !== anchorReportCode.value
			|| !currentAnchor
			|| nextFight.encounterID !== currentAnchor.encounterID
			|| nextFight.difficulty !== currentAnchor.difficulty;
		if (!shouldReanchor) return;

		anchorReportCode.value = reportCode;
		anchorFightID.value = fightID;
		resetVisiblePulls();
		alignmentPhaseKey.value = '';
		timelineHover.value.visible = false;
		hideDetail();
	},
	{ immediate: true },
);

function parseStoredPlayerSelections(value: unknown): StoredPlayerSelections {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

	return Object.fromEntries(
		Object.entries(value)
			.filter(([key, playerID]) => (
				key.length > 0
				&& typeof playerID === 'number'
				&& Number.isSafeInteger(playerID)
				&& playerID > 0
			)),
	);
}

function parseStoredComparisonPreferences(value: unknown): StoredComparisonPreferences | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredComparisonPreferences>;
	if (
		(candidate.sortMode !== 'chronological' && candidate.sortMode !== 'duration')
		|| (candidate.sortDirection !== 'asc' && candidate.sortDirection !== 'desc')
		|| !candidate.alignmentPhaseKeys
		|| typeof candidate.alignmentPhaseKeys !== 'object'
		|| Array.isArray(candidate.alignmentPhaseKeys)
	) return null;

	return {
		sortMode: candidate.sortMode,
		sortDirection: candidate.sortDirection,
		alignmentPhaseKeys: Object.fromEntries(
			Object.entries(candidate.alignmentPhaseKeys)
				.filter(([scopeKey, phaseKey]) => (
					scopeKey.length > 0
					&& typeof phaseKey === 'string'
					&& phaseKey.length > 0
				)),
		),
	};
}

function persistComparisonPreferences() {
	if (!comparisonPreferencesLoaded.value) return;
	const preferences: StoredComparisonPreferences = {
		sortMode: sortMode.value,
		sortDirection: sortDirection.value,
		alignmentPhaseKeys: storedAlignmentPhaseKeys.value,
	};
	store.set(COMPARISON_PREFERENCES_STORE_KEY, preferences).catch((error: unknown) => {
		log.error('Failed to persist review cooldown comparison preferences', error);
	});
}

function initializePlayerSelection() {
	if (!playerSelectionsLoaded.value) return;

	const options = playerOptions.value;
	if (!options.some(option => option.id === selectedPlayerID.value)) {
		const scopeKey = playerSelectionScopeKey.value;
		const storedPlayerID = scopeKey ? storedPlayerSelections.value[scopeKey] : null;
		if (storedPlayerID && options.some(option => option.id === storedPlayerID)) {
			selectedPlayerID.value = storedPlayerID;
			return;
		}

		const anchorPlayerIDs = new Set(anchorFight.value?.friendlyPlayers || []);
		selectedPlayerID.value = options.find(option => anchorPlayerIDs.has(option.id))?.id || options[0]?.id || null;
	}
}

function persistPlayerSelection(playerID: number) {
	const scopeKey = playerSelectionScopeKey.value;
	if (!scopeKey) return;

	storedPlayerSelections.value = {
		...storedPlayerSelections.value,
		[scopeKey]: playerID,
	};
	store.set(PLAYER_SELECTION_STORE_KEY, storedPlayerSelections.value).catch((error: unknown) => {
		log.error('Failed to persist review cooldown comparison player selection', error);
	});
}

function validatePlayerSelectionForActiveFight() {
	const fightID = pendingPlayerRosterValidationFightID;
	if (!playerSelectionsLoaded.value || fightID == null) return;

	const activeFight = reportDetails.value?.fights.find(fight => fight.id === fightID);
	if (!activeFight) return;

	const activePlayerIDs = new Set(activeFight.friendlyPlayers || []);
	if (selectedPlayerID.value != null && activePlayerIDs.has(selectedPlayerID.value)) {
		pendingPlayerRosterValidationFightID = null;
		return;
	}

	const scopeKey = playerSelectionScopeKey.value;
	const storedPlayerID = scopeKey ? storedPlayerSelections.value[scopeKey] : null;
	const fallbackPlayer = (
		storedPlayerID
		&& activePlayerIDs.has(storedPlayerID)
		&& playerOptions.value.some(option => option.id === storedPlayerID)
			? playerOptions.value.find(option => option.id === storedPlayerID)
			: playerOptions.value.find(option => activePlayerIDs.has(option.id))
	);

	if (!fallbackPlayer) {
		selectedPlayerID.value = null;
		pendingPlayerRosterValidationFightID = null;
		return;
	}

	if (selectedPlayerID.value !== fallbackPlayer.id) {
		selectedPlayerID.value = fallbackPlayer.id;
		persistPlayerSelection(fallbackPlayer.id);
	}
	pendingPlayerRosterValidationFightID = null;
}

onMounted(async () => {
	try {
		storedPlayerSelections.value = parseStoredPlayerSelections(
			await store.get(PLAYER_SELECTION_STORE_KEY),
		);
	} catch (error) {
		log.error('Failed to load review cooldown comparison player selection', error);
		storedPlayerSelections.value = {};
	} finally {
		playerSelectionsLoaded.value = true;
		initializePlayerSelection();
	}
});

onMounted(async () => {
	try {
		const preferences = parseStoredComparisonPreferences(
			await store.get(COMPARISON_PREFERENCES_STORE_KEY),
		);
		if (preferences) {
			sortMode.value = preferences.sortMode;
			sortDirection.value = preferences.sortDirection;
			storedAlignmentPhaseKeys.value = preferences.alignmentPhaseKeys;
		}
	} catch (error) {
		log.error('Failed to load review cooldown comparison preferences', error);
	} finally {
		comparisonPreferencesLoaded.value = true;
		initializeStoredPhaseAlignment();
	}
});

watch(playerOptions, initializePlayerSelection, { immediate: true });
watch(playerSelectionScopeKey, (scopeKey, previousScopeKey) => {
	if (scopeKey !== previousScopeKey) {
		const activeFight = reportDetails.value?.fights.find(
			fight => fight.id === reviewsStore.selectedFightID,
		);
		const selectedPlayerIsPresent = selectedPlayerID.value != null
			&& Boolean(activeFight?.friendlyPlayers?.includes(selectedPlayerID.value));
		if (!selectedPlayerIsPresent) selectedPlayerID.value = null;
	}
	initializePlayerSelection();
}, { immediate: true });
watch(
	[
		() => reviewsStore.selectedFightID,
		() => playerSelectionsLoaded.value,
		playerOptions,
	],
	([fightID], [previousFightID]) => {
		if (fightID !== previousFightID) {
			pendingPlayerRosterValidationFightID = fightID;
		}
		void nextTick(validatePlayerSelectionForActiveFight);
	},
	{ immediate: true, flush: 'post' },
);
watch(selectedPlayerID, () => {
	resetVisiblePulls();
	isPlayerPickerOpen.value = false;
});
watch([sortMode, sortDirection], persistComparisonPreferences);

function fightMatchesAnchor(fight: fightDetails) {
	const anchor = anchorFight.value;
	return Boolean(anchor
		&& fight.encounterID === anchor.encounterID
		&& fight.difficulty === anchor.difficulty
		&& fight.startTime <= anchor.startTime);
}

function getPlayerRole(spec?: string): PlayerRole {
	const normalizedSpec = spec?.replace(/\s+/g, '').toLowerCase() || '';
	if (!normalizedSpec) return 'unknown';
	if (TANK_SPECS.has(normalizedSpec)) return 'tank';
	if (HEALER_SPECS.has(normalizedSpec)) return 'healer';
	return 'dps';
}

function selectPlayer(playerID: number) {
	selectedPlayerID.value = playerID;
	persistPlayerSelection(playerID);
	isPlayerPickerOpen.value = false;
}

let appliedPlayerRequestToken: number | null = null;
function applyRequestedPlayer() {
	const token = props.playerRequestToken;
	if (
		token == null
		|| token === appliedPlayerRequestToken
		|| !playerSelectionsLoaded.value
	) return;

	const requestedPlayer = props.requestedPlayerId != null
		? playerOptions.value.find(player => player.id === props.requestedPlayerId)
		: playerOptions.value.find(player => player.name === props.requestedPlayerName);
	if (!requestedPlayer) return;

	appliedPlayerRequestToken = token;
	selectPlayer(requestedPlayer.id);
	emit('playerRequestApplied', token);
}

watch(
	[
		() => props.playerRequestToken,
		() => props.requestedPlayerId,
		() => props.requestedPlayerName,
		playerOptions,
		() => playerSelectionsLoaded.value,
	],
	applyRequestedPlayer,
	{ immediate: true },
);

function onPlayerPickerFocusOut(event: FocusEvent) {
	const nextTarget = event.relatedTarget;
	if (!(nextTarget instanceof Node) || !playerPicker.value?.contains(nextTarget)) {
		isPlayerPickerOpen.value = false;
	}
}

const pullNumberByFightID = computed(() => {
	const anchor = anchorFight.value;
	const matching = (reportDetails.value?.fights || [])
		.filter(fight => anchor && fight.encounterID === anchor.encounterID && fight.difficulty === anchor.difficulty)
		.sort((left, right) => left.startTime - right.startTime);
	return new Map(matching.map((fight, index) => [fight.id, index + 1]));
});
const eligiblePulls = computed(() => {
	const playerID = selectedPlayerID.value;
	if (!playerID) return [];
	return (reportDetails.value?.fights || [])
		.filter(fight => fightMatchesAnchor(fight) && (fight.friendlyPlayers || []).includes(playerID))
		.sort((left, right) => right.startTime - left.startTime);
});
const selectedPulls = computed(() => eligiblePulls.value.slice(0, visiblePullLimit.value));
const hasMorePulls = computed(() => selectedPulls.value.length < eligiblePulls.value.length);
const maxDurationSeconds = computed(() => Math.max(
	1,
	...selectedPulls.value.map(fight => (fight.endTime - fight.startTime) / 1000),
));
const phaseLabelByID = computed(() => {
	const definitions = reportDetails.value?.phases.find(item => item.encounterID === anchorFight.value?.encounterID)?.phases || [];
	let phaseNumber = 0;
	let intermissionNumber = 0;
	return new Map(definitions.map(definition => [
		definition.id,
		definition.isIntermission ? `I${++intermissionNumber}` : `P${++phaseNumber}`,
	]));
});
const phaseLabelOrder = computed(() => new Map(
	[...phaseLabelByID.value.values()].map((label, index) => [label, index]),
));

function getPhaseOccurrenceKey(name: string, occurrence: number) {
	return `${name}:${occurrence}`;
}

function getFightPhaseTimes(fight: fightDetails): PhaseTime[] {
	const durationSeconds = (fight.endTime - fight.startTime) / 1000;
	const occurrenceByName = new Map<string, number>();
	return [...(fight.phaseTransitions || [])]
		.sort((left, right) => left.startTime - right.startTime)
		.map((phase) => {
			const name = phaseLabelByID.value.get(phase.id) || String(phase.id);
			const occurrence = (occurrenceByName.get(name) || 0) + 1;
			occurrenceByName.set(name, occurrence);
			return {
				key: getPhaseOccurrenceKey(name, occurrence),
				name,
				occurrence,
				timestampSeconds: (phase.startTime - fight.startTime) / 1000,
			};
		})
		.filter(phase => phase.timestampSeconds > 0 && phase.timestampSeconds < durationSeconds);
}

const availableAlignmentPhases = computed(() => {
	const phaseByKey = new Map<string, PhaseTime>();
	selectedPulls.value.forEach(fight => getFightPhaseTimes(fight).forEach((phase) => {
		if (!phaseByKey.has(phase.key)) phaseByKey.set(phase.key, phase);
	}));
	return [...phaseByKey.values()].sort((left, right) => (
		(phaseLabelOrder.value.get(left.name) ?? Number.MAX_SAFE_INTEGER)
		- (phaseLabelOrder.value.get(right.name) ?? Number.MAX_SAFE_INTEGER)
		|| left.occurrence - right.occurrence
		|| left.name.localeCompare(right.name)
	));
});
const repeatedPhaseNames = computed(() => new Set(
	availableAlignmentPhases.value
		.filter(phase => phase.occurrence > 1)
		.map(phase => phase.name),
));
const alignmentPhase = computed(() => (
	availableAlignmentPhases.value.find(phase => phase.key === alignmentPhaseKey.value) || null
));
const alignmentPhaseName = computed(() => (
	alignmentPhase.value ? formatPhaseLabel(alignmentPhase.value) : ''
));

function formatPhaseLabel(phase: Pick<PhaseTime, 'name' | 'occurrence'>) {
	return repeatedPhaseNames.value.has(phase.name)
		? `${phase.name} #${phase.occurrence}`
		: phase.name;
}

const alignmentPhaseLabel = computed(() => (
	alignmentPhase.value ? formatPhaseLabel(alignmentPhase.value) : ''
));

let initializedAlignmentContextKey = '';
function initializeStoredPhaseAlignment() {
	if (!comparisonPreferencesLoaded.value) return;
	const scopeKey = playerSelectionScopeKey.value;
	const playerID = selectedPlayerID.value;
	if (!scopeKey || !playerID || selectedPulls.value.length === 0) return;

	const contextKey = `${scopeKey}:${playerID}`;
	if (initializedAlignmentContextKey === contextKey) return;
	const storedPhaseKey = storedAlignmentPhaseKeys.value[scopeKey] || '';
	if (
		storedPhaseKey
		&& !availableAlignmentPhases.value.some(phase => phase.key === storedPhaseKey)
	) {
		// The saved occurrence may only exist in older pulls that have not been
		// added to the view yet. Keep initialization pending so "Load more" can
		// restore it when that occurrence becomes available.
		alignmentPhaseKey.value = '';
		return;
	}

	alignmentPhaseKey.value = storedPhaseKey;
	initializedAlignmentContextKey = contextKey;
}

function persistPhaseAlignment(phaseKey: string) {
	const scopeKey = playerSelectionScopeKey.value;
	if (!scopeKey) return;
	storedAlignmentPhaseKeys.value = phaseKey
		? { ...storedAlignmentPhaseKeys.value, [scopeKey]: phaseKey }
		: Object.fromEntries(
			Object.entries(storedAlignmentPhaseKeys.value)
				.filter(([storedScopeKey]) => storedScopeKey !== scopeKey),
		);
	persistComparisonPreferences();
}

watch(
	[availableAlignmentPhases, playerSelectionScopeKey, selectedPlayerID],
	([phases]) => {
		if (
			alignmentPhaseKey.value
			&& phases.length > 0
			&& !phases.some(phase => phase.key === alignmentPhaseKey.value)
		) {
			alignmentPhaseKey.value = '';
		}
		initializeStoredPhaseAlignment();
	},
	{ immediate: true },
);

function getAlignmentOriginSeconds(fight: fightDetails) {
	if (!alignmentPhaseKey.value) return 0;
	return getFightPhaseTimes(fight)
		.find(phase => phase.key === alignmentPhaseKey.value)
		?.timestampSeconds ?? null;
}

const timelineDomain = computed(() => {
	if (!alignmentPhaseKey.value) {
		return { minSeconds: 0, maxSeconds: maxDurationSeconds.value, durationSeconds: maxDurationSeconds.value };
	}

	const alignedPulls = selectedPulls.value
		.map(fight => ({
			fight,
			originSeconds: getAlignmentOriginSeconds(fight),
		}))
		.filter((item): item is { fight: fightDetails; originSeconds: number } => item.originSeconds != null);
	if (alignedPulls.length === 0) {
		return { minSeconds: 0, maxSeconds: maxDurationSeconds.value, durationSeconds: maxDurationSeconds.value };
	}

	const minSeconds = Math.min(...alignedPulls.map(item => -item.originSeconds));
	const maxSeconds = Math.max(...alignedPulls.map(item => (
		(item.fight.endTime - item.fight.startTime) / 1000 - item.originSeconds
	)));
	return {
		minSeconds,
		maxSeconds,
		durationSeconds: Math.max(1, maxSeconds - minSeconds),
	};
});

function toTimelinePercent(fight: fightDetails, timestampSeconds: number) {
	const originSeconds = getAlignmentOriginSeconds(fight);
	if (originSeconds == null) return null;
	return (timestampSeconds - originSeconds - timelineDomain.value.minSeconds)
		/ timelineDomain.value.durationSeconds;
}

function toFightTimestampSeconds(fight: fightDetails, axisSeconds: number) {
	const originSeconds = getAlignmentOriginSeconds(fight);
	if (originSeconds == null) return null;
	const durationSeconds = (fight.endTime - fight.startTime) / 1000;
	return Math.max(0, Math.min(durationSeconds, axisSeconds + originSeconds));
}

const minuteMarkers = computed(() => {
	const domain = timelineDomain.value;
	const markers: { seconds: number; percent: number }[] = [];
	for (
		let seconds = Math.ceil(domain.minSeconds / 60) * 60;
		seconds < domain.maxSeconds;
		seconds += 60
	) {
		if (seconds <= domain.minSeconds) continue;
		markers.push({
			seconds,
			percent: (seconds - domain.minSeconds) / domain.durationSeconds,
		});
	}
	return markers;
});
const alignmentAnchorPercent = computed(() => (
	(0 - timelineDomain.value.minSeconds) / timelineDomain.value.durationSeconds
));
const currentFightCursorPercent = computed(() => {
	const fight = reportDetails.value?.fights.find(item => item.id === reviewsStore.selectedFightID);
	if (!fight) return null;
	return toTimelinePercent(fight, props.currentFightCursorSeconds);
});

function getPlayerEvents(fightID: number) {
	const reportCode = anchorReportCode.value;
	const playerID = selectedPlayerID.value;
	if (!reportCode || !playerID) return [];
	return (reviewsStore.getFightCooldownDataFor(reportCode, fightID)?.fightCooldownEvents || [])
		.filter(event => event.source?.id === playerID);
}

const comparisonSpellEvents = computed(() => selectedPulls.value.flatMap(fight => getPlayerEvents(fight.id)));
watch(comparisonSpellEvents, events => emit('spellEventsChange', events), { immediate: true });

let loadGeneration = 0;
async function loadPulls(pulls: fightDetails[]) {
	const reportCode = anchorReportCode.value;
	if (!reportCode) return;
	const generation = ++loadGeneration;
	let nextIndex = 0;
	async function worker() {
		while (generation === loadGeneration && nextIndex < pulls.length) {
			const fight = pulls[nextIndex++];
			await Promise.allSettled([
				reviewsStore.ensureFightCooldowns(reportCode, fight.id),
				reviewsStore.ensureFightEvents(reportCode, fight.id),
			]);
		}
	}
	await Promise.all([worker(), worker(), worker()]);
}
watch(
	[
		() => selectedPulls.value.map(fight => fight.id).join(','),
		() => reviewsStore.fightCooldownCacheEpoch,
	],
	() => {
		void loadPulls(selectedPulls.value);
	},
	{ immediate: true },
);

async function retryPull(fightID: number) {
	const reportCode = anchorReportCode.value;
	if (!reportCode) return;
	await Promise.allSettled([
		reviewsStore.ensureFightCooldowns(reportCode, fightID, true),
		reviewsStore.ensureFightEvents(reportCode, fightID, true),
	]);
}

function getActorKey(actor?: { id?: number; guid?: number; name?: string }) {
	if (actor?.id != null) return `id:${actor.id}`;
	if (actor?.guid != null) return `guid:${actor.guid}`;
	return `name:${actor?.name || 'Unknown'}`;
}
function isSelectedActor(actor?: { id?: number; name?: string }) {
	const playerID = selectedPlayerID.value;
	if (actor?.id != null) return actor.id === playerID;
	return actor?.name === actorByID.value.get(playerID || -1)?.name;
}
function buildDeathPeriods(fight: fightDetails): DeathPeriod[] {
	const reportCode = anchorReportCode.value;
	if (!reportCode) return [];
	const durationSeconds = (fight.endTime - fight.startTime) / 1000;
	const openDeaths = new Map<string, DeathPeriod>();
	const periods: DeathPeriod[] = [];
	let deathID = 0;
	[...reviewsStore.getFightEventsFor(reportCode, fight.id)]
		.sort((left, right) => left.timestamp - right.timestamp)
		.forEach((event) => {
			const eventType = event.type.toLowerCase();
			if (eventType === 'death') {
				deathID++;
				if (!event.target || !isSelectedActor(event.target)) return;
				const timestampSeconds = (event.timestamp - fight.startTime) / 1000;
				if (timestampSeconds < 0 || timestampSeconds > durationSeconds) return;
				const actorKey = getActorKey(event.target);
				const previous = openDeaths.get(actorKey);
				if (previous) {
					previous.endTimestampSeconds = timestampSeconds;
					previous.endPercent = toTimelinePercent(fight, timestampSeconds) ?? previous.endPercent;
				}
				const death: DeathPeriod = {
					id: deathID,
					key: `${fight.id}:${deathID}:${event.timestamp}`,
					event,
					timestampSeconds,
					endTimestampSeconds: durationSeconds,
					percent: toTimelinePercent(fight, timestampSeconds) ?? 0,
					endPercent: toTimelinePercent(fight, durationSeconds) ?? 0,
					spell: event.killingAbility?.name || 'Unknown ability',
					icon: event.killingAbility?.abilityIcon || '',
					resurrected: false,
				};
				periods.push(death);
				openDeaths.set(actorKey, death);
				return;
			}
			const reincarnation = eventType === 'cast' && event.ability?.guid === 21169 && isSelectedActor(event.source);
			const resurrection = eventType === 'resurrect' && isSelectedActor(event.target);
			if (!reincarnation && !resurrection) return;
			const actor = reincarnation ? event.source : event.target;
			const death = openDeaths.get(getActorKey(actor));
			if (!death) return;
			const end = Math.max(death.timestampSeconds, Math.min(durationSeconds, (event.timestamp - fight.startTime) / 1000));
			death.endTimestampSeconds = end;
			death.endPercent = toTimelinePercent(fight, end) ?? death.endPercent;
			death.resurrected = true;
			death.resurrectionEvent = event;
			death.resurrectionKind = reincarnation ? 'reincarnation' : 'player';
			openDeaths.delete(getActorKey(actor));
		});
	return periods;
}

function buildPhases(fight: fightDetails): PhaseMarker[] {
	return getFightPhaseTimes(fight).map(phase => ({
		...phase,
		percent: toTimelinePercent(fight, phase.timestampSeconds) ?? 0,
	}));
}

const rows = computed<PullRow[]>(() => {
	const reportCode = anchorReportCode.value;
	if (!reportCode) return [];
	const result = selectedPulls.value.map((fight): PullRow => {
		const durationSeconds = (fight.endTime - fight.startTime) / 1000;
		const isAligned = getAlignmentOriginSeconds(fight) != null;
		const allPlayerEvents = getPlayerEvents(fight.id);
		const visibleEvents = isAligned ? allPlayerEvents.filter(event => (
			event.cooldown.groups.some(groupID => enabledGroupIDSet.value.has(groupID))
			&& !excludedSpellIDSet.value.has(event.cooldown.spellID)
		)) : [];
		const trackEnds: number[] = [];
		const cooldowns = visibleEvents
			.map((event, index) => ({ event, index, timestampSeconds: (event.timestamp - fight.startTime) / 1000 }))
			.filter(marker => marker.timestampSeconds >= 0 && marker.timestampSeconds <= durationSeconds)
			.sort((left, right) => left.timestampSeconds - right.timestampSeconds)
			.map((marker): CooldownMarker => {
				const percent = toTimelinePercent(fight, marker.timestampSeconds) ?? 0;
				let track = trackEnds.findIndex(last => percent - last >= 0.028);
				if (track < 0) track = trackEnds.length;
				trackEnds[track] = percent;
				return { ...marker, percent, track, key: `${fight.id}:${marker.event.timestamp}:${marker.event.cooldown.spellID}:${marker.index}` };
			});
		const playerIndex = (fight.friendlyPlayers || []).indexOf(selectedPlayerID.value || -1);
		const spec = playerIndex >= 0 ? fight.friendlySpecs?.[playerIndex] || '' : '';
		const playerActor = actorByID.value.get(selectedPlayerID.value || -1);
		const className = playerActor?.subType || playerActor?.type || '';
		const actorIcon = className && spec
			? `${className}-${spec.replace(/\s+/g, '')}`
			: allPlayerEvents.find(event => event.source?.icon)?.source?.icon || '';
		return {
			fight,
			pullNumber: pullNumberByFightID.value.get(fight.id) || fight.id,
			durationSeconds,
			isAligned,
			startPercent: toTimelinePercent(fight, 0) ?? 0,
			endPercent: toTimelinePercent(fight, durationSeconds) ?? 0,
			actorIcon,
			phases: isAligned ? buildPhases(fight) : [],
			cooldowns,
			deaths: isAligned ? buildDeathPeriods(fight) : [],
			height: Math.max(50, 23 + Math.max(1, trackEnds.length) * 27),
		};
	});
	return result.sort((left, right) => {
		const factor = sortDirection.value === 'desc' ? -1 : 1;
		const difference = sortMode.value === 'duration'
			? left.durationSeconds - right.durationSeconds
			: left.fight.startTime - right.fight.startTime;
		return difference * factor || (right.fight.startTime - left.fight.startTime);
	});
});

const newestPhaseTimes = computed(() => {
	const result = new Map<string, number>();
	[...rows.value]
		.sort((left, right) => right.fight.startTime - left.fight.startTime)
		.forEach(row => row.phases.forEach((phase) => {
			if (!result.has(phase.key)) result.set(phase.key, phase.timestampSeconds);
		}));
	return result;
});
const visibleCooldownCount = computed(() => rows.value.reduce((total, row) => total + row.cooldowns.length, 0));
const visibleDeathCount = computed(() => rows.value.reduce((total, row) => total + row.deaths.length, 0));
const alignedPullCount = computed(() => rows.value.filter(row => row.isAligned).length);

function formatTime(seconds: number, decimals = false) {
	const rounded = Math.round(Math.max(0, seconds) * (decimals ? 10 : 1));
	const scale = decimals ? 10 : 1;
	const minutes = Math.floor(rounded / (60 * scale));
	const remainder = rounded % (60 * scale);
	return `${minutes}:${(remainder / scale).toFixed(decimals ? 1 : 0).padStart(decimals ? 4 : 2, '0')}`;
}
function formatSignedTime(seconds: number, decimals = false) {
	if (Math.abs(seconds) < (decimals ? 0.05 : 0.5)) return formatTime(0, decimals);
	return `${seconds < 0 ? '−' : '+'}${formatTime(Math.abs(seconds), decimals)}`;
}
function formatAxisTime(seconds: number, decimals = false) {
	return alignmentPhaseKey.value
		? `${alignmentPhaseLabel.value} ${formatSignedTime(seconds, decimals)}`
		: formatTime(seconds, decimals);
}
function formatAbsoluteAndAlignedTime(row: PullRow, seconds: number) {
	const absoluteTime = formatTime(seconds, true);
	if (!alignmentPhaseKey.value) return absoluteTime;
	const originSeconds = getAlignmentOriginSeconds(row.fight);
	return originSeconds == null
		? absoluteTime
		: `${absoluteTime} · ${alignmentPhaseLabel.value} ${formatSignedTime(seconds - originSeconds, true)}`;
}
function formatCooldownTime(row: PullRow, seconds: number) {
	if (alignmentPhaseKey.value) {
		const originSeconds = getAlignmentOriginSeconds(row.fight);
		if (originSeconds != null) {
			return `${formatTime(seconds, true)} · ${alignmentPhaseLabel.value} ${formatSignedTime(seconds - originSeconds, true)}`;
		}
	}
	const phase = row.phases.filter(item => item.timestampSeconds <= seconds).at(-1);
	return phase ? `${formatTime(seconds, true)} · ${formatPhaseLabel(phase)} ${formatTime(seconds - phase.timestampSeconds, true)}` : formatTime(seconds, true);
}
function getSpellIconURL(icon?: string) {
	if (!icon) return '';
	return /^https?:\/\//i.test(icon) ? icon : `https://wow.zamimg.com/images/wow/icons/large/${icon.toLowerCase()}`;
}
function getActorIconURL(icon?: string) {
	if (!icon) return '';
	return /^https?:\/\//i.test(icon) ? icon : `https://assets.rpglogs.com/img/warcraft/icons/${encodeURIComponent(icon)}.jpg`;
}
function getClassColor(className?: string) {
	const colors: Record<string, string> = { deathknight: 'text-[#C41E3A]', demonhunter: 'text-[#A330C9]', druid: 'text-[#FF7C0A]', evoker: 'text-[#33937F]', hunter: 'text-[#AAD372]', mage: 'text-[#3FC7EB]', monk: 'text-[#00FF98]', paladin: 'text-[#F48CBA]', priest: 'text-white', rogue: 'text-[#FFF468]', shaman: 'text-[#0070DD]', warlock: 'text-[#8788EE]', warrior: 'text-[#C69B6D]' };
	return colors[className?.toLowerCase() || ''] || 'text-inherit';
}
function getBorderColor(event: reviewCooldownEvent) {
	const group = event.cooldown.groups.find(groupID => enabledGroupIDSet.value.has(groupID)) || event.cooldown.primaryGroup;
	return { raid_cd: 'border-cyan-400', personals: 'border-violet-400', externals: 'border-pink-400', utility: 'border-blue-400', movement: 'border-emerald-400', dps_cd: 'border-amber-400', interrupts: 'border-lime-400', aoe_cc: 'border-orange-400', single_cc: 'border-red-400' }[group];
}

let tooltipFrame: number | null = null;
let pendingTooltipPoint: { x: number; y: number } | null = null;
let timelineHoverFrame: number | null = null;
let pendingTimelineHover: { clientX: number; plot: HTMLElement } | null = null;
function tooltipPoint(event: MouseEvent) {
	return { x: Math.max(150, Math.min(window.innerWidth - 150, event.clientX)), y: Math.max(100, event.clientY - 12) };
}
function updateTooltip(event: MouseEvent) {
	if (!detailTooltip.value) return;
	pendingTooltipPoint = tooltipPoint(event);
	if (tooltipFrame != null) return;
	tooltipFrame = requestAnimationFrame(() => {
		tooltipFrame = null;
		if (detailTooltip.value && pendingTooltipPoint) detailTooltip.value = { ...detailTooltip.value, ...pendingTooltipPoint };
		pendingTooltipPoint = null;
	});
}
function showCooldown(row: PullRow, marker: CooldownMarker, event: MouseEvent) {
	detailTooltip.value = { kind: 'cooldown', row, marker, ...tooltipPoint(event) };
}
function showDeath(row: PullRow, death: DeathPeriod, event: MouseEvent) {
	detailTooltip.value = { kind: 'death', row, death, ...tooltipPoint(event) };
}
function showPhase(row: PullRow, phase: PhaseMarker, event: MouseEvent) {
	hoveredPhaseKey.value = phase.key;
	const newestTime = newestPhaseTimes.value.get(phase.key);
	detailTooltip.value = { kind: 'phase', row, phase, deltaSeconds: newestTime == null ? null : phase.timestampSeconds - newestTime, ...tooltipPoint(event) };
}
function alignToPhase(phaseKey: string) {
	alignmentPhaseKey.value = phaseKey;
	persistPhaseAlignment(phaseKey);
	timelineHover.value.visible = false;
	hideDetail();
}
function clearPhaseAlignment() {
	alignmentPhaseKey.value = '';
	persistPhaseAlignment('');
	timelineHover.value.visible = false;
	hideDetail();
}
function hideDetail() { detailTooltip.value = null; hoveredPhaseKey.value = null; }
function onTimelineMove(row: PullRow, event: MouseEvent) {
	if (!row.isAligned) {
		onTimelineLeave();
		return;
	}
	pendingTimelineHover = {
		clientX: event.clientX,
		plot: event.currentTarget as HTMLElement,
	};
	if (timelineHoverFrame == null) {
		timelineHoverFrame = requestAnimationFrame(() => {
			timelineHoverFrame = null;
			const pending = pendingTimelineHover;
			pendingTimelineHover = null;
			if (!pending) return;

			const rect = pending.plot.getBoundingClientRect();
			if (rect.width <= 0) return;
			const percent = Math.max(0, Math.min(1, (pending.clientX - rect.left) / rect.width));
			timelineHover.value = {
				visible: true,
				percent,
				timestampSeconds: timelineDomain.value.minSeconds + percent * timelineDomain.value.durationSeconds,
			};
		});
	}
	updateTooltip(event);
}
function onTimelineLeave() {
	pendingTimelineHover = null;
	if (timelineHoverFrame != null) {
		cancelAnimationFrame(timelineHoverFrame);
		timelineHoverFrame = null;
	}
	timelineHover.value.visible = false;
	hideDetail();
}
function seekAtEvent(row: PullRow, event: MouseEvent) {
	if (!row.isAligned) return;
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
	const timestampSeconds = toFightTimestampSeconds(
		row.fight,
		timelineDomain.value.minSeconds + percent * timelineDomain.value.durationSeconds,
	);
	if (timestampSeconds != null) emit('seekPull', row.fight.id, timestampSeconds);
}
function cacheKey(fightID: number) { return `${anchorReportCode.value}:${fightID}`; }
function hasPullData(fightID: number) {
	const key = cacheKey(fightID);
	return Object.prototype.hasOwnProperty.call(reviewsStore.savedFightCooldowns, key)
		&& Object.prototype.hasOwnProperty.call(reviewsStore.savedFightEvents, key);
}
function getPullError(fightID: number) {
	const reportCode = anchorReportCode.value;
	if (!reportCode) return null;
	return reviewsStore.getFightCooldownErrorFor(reportCode, fightID) || reviewsStore.getFightEventsErrorFor(reportCode, fightID);
}
function isPullLoading(fightID: number) {
	const reportCode = anchorReportCode.value;
	if (!reportCode) return false;
	return reviewsStore.isFightCooldownsLoadingFor(reportCode, fightID) || reviewsStore.isFightEventsLoadingFor(reportCode, fightID);
}

let scrollbarTimer: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let scrollbarDrag: { pointerID: number; startY: number; startTop: number } | null = null;
type PullScrollAnchor = { fightID: string; offsetTop: number };

function resetVisiblePulls() {
	visiblePullLimit.value = INITIAL_PULL_LIMIT;
	lastAutoLoadAt = Number.NEGATIVE_INFINITY;
	void nextTick(() => {
		if (scroller.value) scroller.value.scrollTop = 0;
		updateScrollbar();
	});
}

function getPullScrollAnchor(viewport: HTMLElement): PullScrollAnchor | null {
	const viewportTop = viewport.getBoundingClientRect().top;
	const row = [...viewport.querySelectorAll<HTMLElement>('[data-comparison-pull-id]')]
		.find(element => element.getBoundingClientRect().bottom > viewportTop + 1);
	const fightID = row?.dataset.comparisonPullId;
	if (!row || !fightID) return null;
	return {
		fightID,
		offsetTop: row.getBoundingClientRect().top - viewportTop,
	};
}

function restorePullScrollAnchor(viewport: HTMLElement, anchor: PullScrollAnchor | null) {
	if (!anchor) return;
	const row = viewport.querySelector<HTMLElement>(`[data-comparison-pull-id="${anchor.fightID}"]`);
	if (!row) return;
	const viewportTop = viewport.getBoundingClientRect().top;
	viewport.scrollTop += row.getBoundingClientRect().top - viewportTop - anchor.offsetTop;
}

async function loadNextPullBatch() {
	if (autoLoadPending || !hasMorePulls.value) return;
	const viewport = scroller.value;
	const anchor = viewport ? getPullScrollAnchor(viewport) : null;
	autoLoadPending = true;
	visiblePullLimit.value = Math.min(
		visiblePullLimit.value + PULL_LOAD_BATCH_SIZE,
		eligiblePulls.value.length,
	);
	await nextTick();
	if (viewport) restorePullScrollAnchor(viewport, anchor);
	autoLoadPending = false;
	updateScrollbar();
}

function tryAutoLoadPulls() {
	const viewport = scroller.value;
	if (!viewport || autoLoadPending || !hasMorePulls.value) return;
	const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
	if (distanceFromBottom > AUTO_LOAD_THRESHOLD_PX) return;
	const now = performance.now();
	if (now - lastAutoLoadAt < AUTO_LOAD_THROTTLE_MS) return;
	lastAutoLoadAt = now;
	void loadNextPullBatch();
}

function updateScrollbar() {
	const viewport = scroller.value;
	const track = scrollbarTrack.value;
	if (!viewport || !track) return;
	const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	const visible = maxScroll > 1;
	const thumbHeight = visible
		? Math.min(track.clientHeight, Math.max(36, track.clientHeight * viewport.clientHeight / viewport.scrollHeight))
		: track.clientHeight;
	const thumbTop = maxScroll ? viewport.scrollTop / maxScroll * Math.max(0, track.clientHeight - thumbHeight) : 0;
	scrollbar.value = { ...scrollbar.value, visible, thumbHeight, thumbTop, maxScroll };
}
function onScroll() {
	updateScrollbar();
	scrollbar.value.active = true;
	if (scrollbarTimer != null) clearTimeout(scrollbarTimer);
	scrollbarTimer = window.setTimeout(() => { scrollbar.value.active = false; }, 900);
	tryAutoLoadPulls();
}
function onComparisonWheel(event: WheelEvent) {
	if (event.deltaY > 0) tryAutoLoadPulls();
}
function onTrackPointer(event: PointerEvent) {
	const viewport = scroller.value;
	const track = scrollbarTrack.value;
	if (event.button !== 0 || !viewport || !track || !scrollbar.value.visible) return;
	event.preventDefault();
	scrollbar.value.active = true;
	const rect = track.getBoundingClientRect();
	const maxTop = Math.max(1, rect.height - scrollbar.value.thumbHeight);
	const top = Math.max(0, Math.min(maxTop, event.clientY - rect.top - scrollbar.value.thumbHeight / 2));
	viewport.scrollTop = top / maxTop * scrollbar.value.maxScroll;
}
function setThumbTop(top: number) {
	const viewport = scroller.value;
	const track = scrollbarTrack.value;
	if (!viewport || !track) return;
	const maxTop = Math.max(1, track.clientHeight - scrollbar.value.thumbHeight);
	viewport.scrollTop = Math.max(0, Math.min(maxTop, top)) / maxTop * scrollbar.value.maxScroll;
}
function onThumbDown(event: PointerEvent) {
	if (event.button !== 0) return;
	event.preventDefault();
	const thumb = event.currentTarget as HTMLElement;
	thumb.setPointerCapture(event.pointerId);
	scrollbar.value.active = true;
	scrollbarDrag = { pointerID: event.pointerId, startY: event.clientY, startTop: scrollbar.value.thumbTop };
}
function onThumbMove(event: PointerEvent) {
	if (!scrollbarDrag || scrollbarDrag.pointerID !== event.pointerId) return;
	setThumbTop(scrollbarDrag.startTop + event.clientY - scrollbarDrag.startY);
}
function onThumbEnd(event: PointerEvent) {
	if (!scrollbarDrag || scrollbarDrag.pointerID !== event.pointerId) return;
	const thumb = event.currentTarget as HTMLElement;
	if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
	scrollbarDrag = null;
	onScroll();
}
function onScrollbarKeydown(event: KeyboardEvent) {
	const viewport = scroller.value;
	if (!viewport || !scrollbar.value.visible) return;

	let nextScrollTop = viewport.scrollTop;
	switch (event.key) {
		case 'ArrowUp': nextScrollTop -= 36; break;
		case 'ArrowDown': nextScrollTop += 36; break;
		case 'PageUp': nextScrollTop -= viewport.clientHeight * 0.9; break;
		case 'PageDown': nextScrollTop += viewport.clientHeight * 0.9; break;
		case 'Home': nextScrollTop = 0; break;
		case 'End': nextScrollTop = scrollbar.value.maxScroll; break;
		default: return;
	}

	event.preventDefault();
	viewport.scrollTop = nextScrollTop;
	scrollbar.value.active = true;
}
watch(scroller, async (value) => {
	resizeObserver?.disconnect();
	if (!value) return;
	await nextTick();
	resizeObserver = new ResizeObserver(updateScrollbar);
	resizeObserver.observe(value);
	updateScrollbar();
});
watch(rows, () => void nextTick(updateScrollbar));
onBeforeUnmount(() => {
	loadGeneration++;
	scrollbarDrag = null;
	resizeObserver?.disconnect();
	if (scrollbarTimer != null) clearTimeout(scrollbarTimer);
	if (tooltipFrame != null) cancelAnimationFrame(tooltipFrame);
	pendingTimelineHover = null;
	if (timelineHoverFrame != null) cancelAnimationFrame(timelineHoverFrame);
});
</script>

<template>
	<div class="flex min-h-0 flex-1 flex-col bg-light4 dark:bg-dark4">
		<div class="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-500/25 bg-neutral-950/5 px-3 py-1 text-xs dark:bg-black/15">
			<div class="flex items-center gap-1.5">
				<span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Player</span>
				<div ref="playerPicker" class="relative" @focusout="onPlayerPickerFocusOut" @keydown.esc="isPlayerPickerOpen = false">
					<button
						type="button"
						class="flex h-7 w-40 items-center gap-1.5 rounded-sm border border-neutral-500/30 bg-light4 px-1.5 text-left text-xs outline-none hover:border-neutral-400/50 focus:border-sky-500 dark:bg-dark4 xl:w-52"
						aria-haspopup="listbox"
						:aria-expanded="isPlayerPickerOpen"
						@click="isPlayerPickerOpen = !isPlayerPickerOpen"
					>
						<img
							v-if="selectedPlayerOption?.actorIcon"
							:src="getActorIconURL(selectedPlayerOption.actorIcon)"
							:alt="`${selectedPlayerOption.spec} specialization`"
							class="size-4 shrink-0 rounded-none border border-neutral-500/50 bg-black object-cover"
							draggable="false"
						/>
						<span v-if="selectedPlayerOption" class="min-w-0 flex-1 truncate font-medium" :class="getClassColor(selectedPlayerOption.className)">{{ selectedPlayerOption.name }}</span>
						<span v-else class="min-w-0 flex-1 text-neutral-500">Select player</span>
						<span class="shrink-0 text-[10px] text-neutral-500">▾</span>
					</button>
					<div
						v-if="isPlayerPickerOpen"
						class="absolute left-0 top-[calc(100%+3px)] z-[100] max-h-72 w-60 overflow-x-hidden overflow-y-auto border border-neutral-500/45 bg-light4 py-1 shadow-xl dark:bg-dark4"
						role="listbox"
					>
						<button
							v-for="player in playerOptions"
							:key="player.id"
							type="button"
							role="option"
							class="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-sky-500/10 focus:bg-sky-500/10 focus:outline-none"
							:class="player.id === selectedPlayerID ? 'bg-neutral-500/10' : ''"
							:aria-selected="player.id === selectedPlayerID"
							@click="selectPlayer(player.id)"
						>
							<img
								v-if="player.actorIcon"
								:src="getActorIconURL(player.actorIcon)"
								:alt="`${player.spec} specialization`"
								:title="player.spec || 'Unknown specialization'"
								class="size-5 shrink-0 rounded-none border border-neutral-500/50 bg-black object-cover"
								draggable="false"
							/>
							<span v-else class="size-5 shrink-0 border border-neutral-500/30 bg-black/25"></span>
							<span class="min-w-0 flex-1 leading-tight">
								<span class="block truncate text-xs font-semibold" :class="getClassColor(player.className)">{{ player.name }}</span>
								<span class="block truncate text-[10px] text-neutral-500">{{ player.spec || 'Unknown spec' }} · {{ player.className || 'Unknown class' }}</span>
							</span>
							<span class="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">{{ ROLE_LABELS[player.role] }}</span>
						</button>
					</div>
				</div>
			</div>
			<label class="ml-2 flex items-center gap-1.5"><span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Sort</span>
				<select v-model="sortMode" class="h-7 rounded-sm border border-neutral-500/30 bg-light4 px-2 text-xs outline-none focus:border-sky-500 dark:bg-dark4"><option value="chronological">Chronological</option><option value="duration">Pull duration</option></select>
			</label>
			<button type="button" class="flex size-7 items-center justify-center rounded-sm border border-neutral-500/30 text-base hover:border-sky-500/60 hover:bg-sky-500/10" :title="sortDirection === 'desc' ? 'Descending' : 'Ascending'" @click="sortDirection = sortDirection === 'desc' ? 'asc' : 'desc'">{{ sortDirection === 'desc' ? '↓' : '↑' }}</button>
			<button v-if="alignmentPhaseName" type="button" class="flex h-7 items-center gap-1.5 border border-sky-500/40 bg-sky-500/10 px-2 text-sky-600 hover:border-sky-400 hover:bg-sky-500/15 dark:text-sky-300" :title="`Aligned to ${alignmentPhaseName}. Click to return to fight-start time.`" @click="clearPhaseAlignment">
				<span class="text-[10px] font-semibold uppercase tracking-wider">Aligned</span>
				<span class="font-semibold">{{ alignmentPhaseName }}</span>
				<span class="text-[10px] tabular-nums text-neutral-500">{{ alignedPullCount }}/{{ rows.length }}</span>
				<span class="text-sm leading-none">×</span>
			</button>
			<div class="ml-auto flex min-w-0 items-center gap-1.5">
				<span class="hidden rounded-sm border border-neutral-500/25 bg-neutral-500/[0.07] px-2 py-1 tabular-nums text-neutral-500 2xl:inline-flex">{{ selectedPulls.length }}/{{ eligiblePulls.length }} pulls · {{ visibleCooldownCount }} casts · {{ visibleDeathCount }} deaths</span>
				<span class="rounded-sm border border-neutral-500/25 bg-neutral-500/[0.07] px-2 py-1 tabular-nums text-neutral-500 2xl:hidden">{{ selectedPulls.length }}/{{ eligiblePulls.length }}</span>
				<button v-if="hasMorePulls" type="button" class="h-7 rounded-sm px-2 text-neutral-500 hover:bg-neutral-500/10 hover:text-inherit" @click="visiblePullLimit = eligiblePulls.length">Load all</button>
			</div>
		</div>
		<div v-if="playerOptions.length === 0" class="flex flex-1 items-center justify-center text-sm text-neutral-500">Player roster metadata is unavailable for this pull.</div>
		<div v-else-if="rows.length === 0" class="flex flex-1 items-center justify-center text-sm text-neutral-500">No matching pulls contain this player.</div>
		<div v-else class="flex min-h-0 flex-1 flex-col">
			<div class="relative z-30 flex h-8 shrink-0 border-b border-neutral-500/25 bg-light4 text-[10px] text-neutral-500 shadow-sm dark:bg-dark4">
				<div class="flex min-w-0 shrink-0 items-center border-r border-neutral-500/25 px-2 font-semibold uppercase tracking-wider" style="width: var(--review-timeline-sidebar-width);">
					<span class="truncate">Pull / {{ actorByID.get(selectedPlayerID || -1)?.name }}</span>
				</div>
				<div class="relative min-w-0 flex-1 tabular-nums">
					<template v-if="alignmentPhaseName">
						<span class="absolute left-1 top-1.5">{{ formatSignedTime(timelineDomain.minSeconds) }}</span>
						<span class="absolute top-1.5 -translate-x-1/2 font-semibold text-sky-500" :style="{ left: `${alignmentAnchorPercent * 100}%` }">{{ alignmentPhaseName }} 0:00</span>
						<span class="absolute right-2 top-1.5">{{ formatSignedTime(timelineDomain.maxSeconds) }}</span>
					</template>
					<template v-else>
						<span class="absolute left-1 top-1.5">0:00</span>
						<span class="absolute left-1/2 top-1.5 -translate-x-1/2">{{ formatTime(timelineDomain.durationSeconds / 2) }}</span>
						<span class="absolute right-2 top-1.5">{{ formatTime(timelineDomain.maxSeconds) }}</span>
					</template>
					<span v-if="timelineHover.visible" class="pointer-events-none absolute top-0 z-40 -translate-x-1/2 border border-neutral-400/40 bg-black/90 px-1.5 py-0.5 text-[11px] text-white shadow" :style="{ left: `${timelineHover.percent * 100}%` }">{{ formatAxisTime(timelineHover.timestampSeconds, true) }}</span>
				</div>
			</div>
			<div class="relative min-h-0 flex-1">
				<div id="review-cooldown-comparison-scroll-viewport" ref="scroller" class="comparison-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto" @scroll="onScroll" @wheel.passive="onComparisonWheel">
					<div v-for="(row, rowIndex) in rows" :key="row.fight.id" :data-comparison-pull-id="row.fight.id" class="flex min-w-0 border-b border-neutral-500/20" :class="rowIndex % 2 ? 'bg-neutral-500/[0.07]' : 'bg-transparent'" :style="{ height: `${row.height}px` }">
						<div class="relative z-20 flex shrink-0 items-center gap-1.5 border-r border-neutral-500/25 bg-light4/95 px-2 shadow-[3px_0_7px_rgba(0,0,0,0.1)] dark:bg-dark4/95" style="width: var(--review-timeline-sidebar-width);">
							<span class="pointer-events-none absolute inset-y-1 left-0 z-20 w-1 bg-sky-500/55" :class="{ 'bg-amber-400/80': row.fight.id === anchorFightID }"></span>
							<button
								type="button"
								class="peer absolute inset-0 z-0 cursor-pointer hover:bg-sky-500/[0.07] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-sky-500"
								:title="`Open pull #${row.pullNumber} in Warcraft Logs`"
								:aria-label="`Open pull #${row.pullNumber} in Warcraft Logs`"
								@click="emit('openPull', row.fight.id)"
							></button>
							<div class="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 peer-hover:text-sky-500">
								<img v-if="row.actorIcon" :src="getActorIconURL(row.actorIcon)" alt="" class="size-5 shrink-0 rounded-none border border-neutral-500/45 bg-black" />
								<span class="min-w-0 flex-1 leading-tight">
									<span class="flex items-center gap-1.5 font-semibold"><span>#{{ row.pullNumber }}</span><span v-if="row.fight.id === anchorFightID" class="text-[9px] uppercase tracking-wider text-amber-500">Current</span><span :class="row.fight.kill ? 'text-emerald-500' : 'text-neutral-500'">{{ row.fight.kill ? 'KILL' : `${row.fight.bossPercentage?.toFixed(1) ?? '?'}%` }}</span></span>
									<span class="block truncate text-[10px] tabular-nums text-neutral-500">{{ formatTime(row.durationSeconds, true) }}</span>
								</span>
							</div>
							<button v-if="getPullError(row.fight.id)" type="button" class="relative z-20 shrink-0 text-[10px] text-red-500 hover:underline" :title="getPullError(row.fight.id) || ''" @click.stop="retryPull(row.fight.id)">Retry</button>
							<span v-else-if="isPullLoading(row.fight.id) || !hasPullData(row.fight.id)" class="pointer-events-none relative z-10 size-3 shrink-0 animate-pulse border border-sky-400/60 bg-sky-500/20"></span>
						</div>
						<div data-pull-plot class="relative min-w-0 flex-1 cursor-pointer overflow-hidden hover:bg-sky-500/[0.025]" @click="seekAtEvent(row, $event)" @mousemove="onTimelineMove(row, $event)" @mouseleave="onTimelineLeave">
							<div v-for="marker in minuteMarkers" :key="marker.seconds" class="pointer-events-none absolute inset-y-0 z-[1] w-px bg-neutral-500/20" :style="{ left: `${marker.percent * 100}%` }"></div>
							<div v-if="row.isAligned && row.startPercent > 0" class="pointer-events-none absolute inset-y-0 left-0 z-[2] bg-black/20" :style="{ width: `${row.startPercent * 100}%` }"></div>
							<div v-if="row.isAligned && row.startPercent > 0" class="pointer-events-none absolute inset-y-0 z-[3] w-px bg-neutral-400/45" :style="{ left: `${row.startPercent * 100}%` }"></div>
							<div v-if="row.isAligned" class="pointer-events-none absolute inset-y-0 right-0 z-[2] bg-black/20" :style="{ left: `${row.endPercent * 100}%` }"></div>
							<div v-if="row.isAligned" class="pointer-events-none absolute inset-y-0 z-[4] w-0.5" :class="row.fight.kill ? 'bg-emerald-500/80' : 'bg-red-500/70'" :style="{ left: `${row.endPercent * 100}%` }"></div>
							<div v-if="row.isAligned && row.fight.id === reviewsStore.selectedFightID && currentFightCursorPercent != null && currentFightCursorPercent >= row.startPercent && currentFightCursorPercent <= row.endPercent" class="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]" :style="{ left: `${currentFightCursorPercent * 100}%` }"><span class="absolute -left-1 top-0 size-0 border-x-4 border-t-4 border-x-transparent border-t-amber-400"></span></div>
							<button v-for="phase in row.phases" :key="`${row.fight.id}:${phase.key}`" type="button" class="group absolute inset-y-0 z-10 w-3 -translate-x-1/2 focus:outline-none" :style="{ left: `${phase.percent * 100}%` }" @click.stop="alignToPhase(phase.key)" @mouseenter="showPhase(row, phase, $event)" @mousemove="updateTooltip" @mouseleave="hideDetail">
								<span class="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-sky-400/75 group-focus-visible:bg-white" :class="phase.key === alignmentPhaseKey ? 'bg-sky-300 shadow-[0_0_5px_rgba(125,211,252,0.65)]' : hoveredPhaseKey === phase.key ? 'bg-white shadow-[0_0_6px_rgba(125,211,252,0.9)]' : ''"></span>
								<span class="pointer-events-none absolute left-[calc(50%+3px)] top-0 whitespace-nowrap bg-slate-950/75 px-1 text-[9px] font-semibold text-sky-300">{{ formatPhaseLabel(phase) }}</span>
							</button>
							<button v-for="death in row.deaths" :key="death.key" type="button" class="absolute inset-y-0 z-[6] min-w-[3px] border-x border-red-400/70 bg-red-800/45 hover:z-20 hover:bg-red-700/65 focus:outline-none" :style="{ left: `${death.percent * 100}%`, width: `${Math.max(0, death.endPercent - death.percent) * 100}%`, backgroundImage: 'repeating-linear-gradient(135deg, rgba(248,113,113,.22) 0, rgba(248,113,113,.22) 4px, transparent 4px, transparent 8px)' }" @click.stop="emit('seekPull', row.fight.id, Math.max(0, death.timestampSeconds - 10))" @contextmenu.prevent.stop="emit('openDeath', row.fight.id, death.id)" @mouseenter="showDeath(row, death, $event)" @mousemove="updateTooltip" @mouseleave="hideDetail"></button>
							<button v-for="cooldown in row.cooldowns" :key="cooldown.key" type="button" class="absolute z-20 size-6 -translate-x-1/2 overflow-hidden rounded-none border bg-black shadow-[0_1px_4px_rgba(0,0,0,.45)] transition-none hover:z-30 hover:scale-105 focus:z-30 focus:outline-none focus:ring-1 focus:ring-white/70" :class="getBorderColor(cooldown.event)" :style="{ left: `clamp(12px, ${cooldown.percent * 100}%, calc(100% - 12px))`, top: `${18 + cooldown.track * 27}px` }" :aria-label="`${cooldown.event.source?.name || 'Unknown player'} used ${cooldown.event.ability?.name || `Spell ${cooldown.event.cooldown.spellID}`}${cooldown.event.cooldown.interruptSuccessful == null ? '' : cooldown.event.cooldown.interruptSuccessful ? ', interrupt successful' : ', no interrupt recorded'}`" @click.stop="emit('seekPull', row.fight.id, cooldown.timestampSeconds)" @mouseenter="showCooldown(row, cooldown, $event)" @mousemove="updateTooltip" @mouseleave="hideDetail">
								<img v-if="cooldown.event.ability?.abilityIcon" :src="getSpellIconURL(cooldown.event.ability.abilityIcon)" alt="" class="size-full" draggable="false" /><span v-else class="flex size-full items-center justify-center text-[10px] text-white">?</span>
								<span v-if="cooldown.event.cooldown.interruptSuccessful != null" class="pointer-events-none absolute bottom-0 right-0 flex size-3 items-center justify-center border-l border-t border-black/70 text-[9px] font-black leading-none text-white" :class="cooldown.event.cooldown.interruptSuccessful ? 'bg-emerald-600' : 'bg-red-700'">{{ cooldown.event.cooldown.interruptSuccessful ? '✓' : '×' }}</span>
							</button>
							<div v-if="row.isAligned && timelineHover.visible" class="pointer-events-none absolute inset-y-0 z-40 w-px bg-white/55" :style="{ left: `${timelineHover.percent * 100}%` }"></div>
							<div v-if="!row.isAligned" class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 text-[10px] font-medium text-neutral-500">{{ alignmentPhaseName }} not reached</div>
							<div v-else-if="hasPullData(row.fight.id) && row.cooldowns.length === 0 && row.deaths.length === 0" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-neutral-500">No matching cooldowns or deaths</div>
						</div>
					</div>
				</div>
				<div ref="scrollbarTrack" class="absolute inset-y-0 right-0 z-50 w-2.5 border-l border-neutral-500/25 bg-slate-950/25 transition-opacity duration-300" :class="!scrollbar.visible ? 'pointer-events-none opacity-0' : scrollbar.active ? 'opacity-100' : 'opacity-0 hover:opacity-100'" @pointerdown="onTrackPointer">
					<button
						v-show="scrollbar.visible"
						type="button"
						class="absolute inset-x-0 touch-none cursor-grab border-y border-neutral-200/25 bg-neutral-400/65 hover:bg-neutral-300/75 active:cursor-grabbing focus:outline-none focus:ring-1 focus:ring-inset focus:ring-sky-300"
						:style="{ top: `${scrollbar.thumbTop}px`, height: `${scrollbar.thumbHeight}px` }"
						role="scrollbar"
						aria-label="Scroll pull comparison"
						aria-controls="review-cooldown-comparison-scroll-viewport"
						aria-orientation="vertical"
						:aria-valuemin="0"
						:aria-valuemax="Math.round(scrollbar.maxScroll)"
						:aria-valuenow="Math.round(scroller?.scrollTop || 0)"
						@pointerdown.stop="onThumbDown"
						@pointermove="onThumbMove"
						@pointerup="onThumbEnd"
						@pointercancel="onThumbEnd"
						@keydown="onScrollbarKeydown"
					></button>
				</div>
			</div>
		</div>
		<Teleport to="body">
			<div v-if="detailTooltip?.kind === 'cooldown'" class="pointer-events-none fixed z-[999] w-max max-w-80 -translate-x-1/2 -translate-y-full rounded-md border border-neutral-500/60 bg-black/90 px-3 py-2 text-xs text-white shadow-xl" :style="{ left: `${detailTooltip.x}px`, top: `${detailTooltip.y}px` }">
				<div class="flex items-center gap-2"><img v-if="detailTooltip.marker.event.ability?.abilityIcon" :src="getSpellIconURL(detailTooltip.marker.event.ability.abilityIcon)" alt="" class="size-8 rounded-none" />
					<div><div class="font-semibold">{{ detailTooltip.marker.event.ability?.name || `Spell ${detailTooltip.marker.event.cooldown.spellID}` }}</div><div><span :class="getClassColor(detailTooltip.marker.event.source?.type)">{{ detailTooltip.marker.event.source?.name }}</span><span v-if="detailTooltip.marker.event.sourcePet?.name" class="text-neutral-400"> via {{ detailTooltip.marker.event.sourcePet.name }}</span> at {{ formatCooldownTime(detailTooltip.row, detailTooltip.marker.timestampSeconds) }}</div></div>
				</div>
				<ReviewCooldownTarget v-if="detailTooltip.marker.event.target" :target="detailTooltip.marker.event.target" :target-marker="detailTooltip.marker.event.targetMarker" :target-instance="detailTooltip.marker.event.targetInstance" />
				<div v-if="detailTooltip.marker.event.cooldown.interruptSuccessful != null" class="mt-1 text-[11px] font-medium" :class="detailTooltip.marker.event.cooldown.interruptSuccessful ? 'text-emerald-300' : 'text-red-300'">
					<template v-if="detailTooltip.marker.event.cooldown.interruptSuccessful">Interrupted {{ detailTooltip.marker.event.extraAbility?.name || 'a spell' }}</template>
					<template v-else>No interrupt recorded</template>
				</div>
				<div class="mt-1 text-[10px] text-neutral-400">Pull #{{ detailTooltip.row.pullNumber }} · Click to open and seek</div>
			</div>
			<div v-else-if="detailTooltip?.kind === 'death'" class="pointer-events-none fixed z-[999] w-max max-w-80 -translate-x-1/2 -translate-y-full rounded-md border border-red-500/60 bg-black/90 px-3 py-2 text-xs text-white shadow-xl" :style="{ left: `${detailTooltip.x}px`, top: `${detailTooltip.y}px` }">
				<div class="font-semibold">{{ formatAbsoluteAndAlignedTime(detailTooltip.row, detailTooltip.death.timestampSeconds) }} {{ actorByID.get(selectedPlayerID || -1)?.name }} died</div>
				<div class="mt-1 flex items-center gap-2"><img v-if="detailTooltip.death.icon" :src="getSpellIconURL(detailTooltip.death.icon)" alt="" class="size-7 rounded-none" /><span>to {{ detailTooltip.death.spell }}</span></div>
				<div v-if="detailTooltip.death.resurrectionKind === 'reincarnation'" class="mt-1 text-[11px] text-neutral-300">Self-resurrected at {{ formatAbsoluteAndAlignedTime(detailTooltip.row, detailTooltip.death.endTimestampSeconds) }}</div>
				<div v-else-if="detailTooltip.death.resurrected" class="mt-1 text-[11px] text-neutral-300">Resurrected by {{ detailTooltip.death.resurrectionEvent?.source?.name || 'Unknown player' }} at {{ formatAbsoluteAndAlignedTime(detailTooltip.row, detailTooltip.death.endTimestampSeconds) }}</div>
				<div v-else class="mt-1 text-[11px] text-neutral-300">Dead for the remainder of the pull</div>
				<div class="mt-1 text-[10px] text-neutral-400">Click: seek 10s before · Right-click: open WCL death</div>
			</div>
			<div v-else-if="detailTooltip?.kind === 'phase'" class="pointer-events-none fixed z-[999] -translate-x-1/2 -translate-y-full rounded-md border border-sky-500/50 bg-black/90 px-3 py-2 text-xs text-white shadow-xl" :style="{ left: `${detailTooltip.x}px`, top: `${detailTooltip.y}px` }">
				<div class="font-semibold">Pull #{{ detailTooltip.row.pullNumber }} · {{ formatPhaseLabel(detailTooltip.phase) }}</div><div>Started at {{ formatAbsoluteAndAlignedTime(detailTooltip.row, detailTooltip.phase.timestampSeconds) }}</div>
				<div v-if="detailTooltip.deltaSeconds != null" class="mt-0.5 text-[11px] text-neutral-300">{{ detailTooltip.deltaSeconds >= 0 ? '+' : '' }}{{ detailTooltip.deltaSeconds.toFixed(1) }}s vs newest pull</div>
				<div class="mt-1 text-[10px] text-neutral-400">Click to align all pulls to {{ formatPhaseLabel(detailTooltip.phase) }}</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
.comparison-scroll { scrollbar-width: none; }
.comparison-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
</style>
