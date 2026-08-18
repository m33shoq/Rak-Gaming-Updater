<script setup lang="ts">
import log from 'electron-log/renderer';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import ReviewBossCastInterrupt from '@/renderer/components/ReviewBossCastInterrupt.vue';
import ReviewCooldownComparison from '@/renderer/components/ReviewCooldownComparison.vue';
import ReviewCooldownTarget from '@/renderer/components/ReviewCooldownTarget.vue';
import ReviewRaidMarker from '@/renderer/components/ReviewRaidMarker.vue';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';
import { buildCollapsedBossCastMarkers, sortBossCastAbilitiesByFirstOccurrence } from '@/renderer/utils/bossCastAggregation';
import { useBossCastTooltipLayout } from '@/renderer/utils/bossCastTooltipLayout';
import { refreshWowheadTooltips } from '@/renderer/utils/wowheadTooltips';
import type { ReviewTimelineViewMode } from '@/timelineWindow';

const props = withDefaults(defineProps<{
	events?: reviewCooldownEvent[];
	fightEvents?: fightEvent[];
	groups?: reviewCooldownGroup[];
	phases?: reviewPhaseMarker[];
	fightStartTime: number;
	fightDuration: number;
	cursorPercent?: number;
	loading?: boolean;
	error?: string | null;
	detached?: boolean;
	expanded?: boolean;
	viewMode?: ReviewTimelineViewMode;
}>(), {
	events: () => [],
	fightEvents: () => [],
	groups: () => [],
	phases: () => [],
	cursorPercent: 0,
	loading: false,
	error: null,
	detached: false,
	expanded: false,
	viewMode: 'fight',
});

const emit = defineEmits<{
	seek: [timestampSeconds: number];
	openFight: [fightID?: number];
	openDeath: [deathID: number];
	seekPull: [fightID: number, timestampSeconds: number];
	openPullDeath: [fightID: number, deathID: number];
	detach: [];
	'update:expanded': [expanded: boolean];
	'update:viewMode': [viewMode: ReviewTimelineViewMode];
}>();

const reviewsStore = useReviewsStore();
const isExpanded = ref(props.detached || props.expanded);
const timelineViewMode = ref<ReviewTimelineViewMode>(props.viewMode);
const comparisonSpellEvents = ref<reviewCooldownEvent[]>([]);
const comparisonPlayerRequest = ref<{
	token: number;
	playerID?: number;
	playerName: string;
} | null>(null);
let nextComparisonPlayerRequestToken = 1;

watch(() => props.detached, (detached) => {
	if (detached) isExpanded.value = true;
});
watch(() => props.expanded, (expanded) => {
	if (!props.detached && isExpanded.value !== expanded) isExpanded.value = expanded;
});
watch(isExpanded, (expanded) => {
	if (!props.detached && expanded !== props.expanded) emit('update:expanded', expanded);
});
watch(() => props.viewMode, (viewMode) => {
	if (timelineViewMode.value !== viewMode) timelineViewMode.value = viewMode;
});
watch(timelineViewMode, (viewMode) => {
	if (viewMode !== props.viewMode) emit('update:viewMode', viewMode);
});

const MIN_EVENT_GAP_PERCENT = 0.026;
const TRACK_HEIGHT_PX = 27;
const TRACK_TOP_OFFSET_PX = 5;
const ROLE_HEADER_HEIGHT_PX = 22;
const BOSS_CAST_LANE_HEIGHT_PX = 34;
const REINCARNATION_CAST_SPELL_ID = 21169;
const GROUP_FILTER_STORE_KEY = 'reviewCooldownTimelineGroupFilters';
const SPELL_FILTER_STORE_KEY = 'reviewCooldownTimelineSpellFilters';
const LEGACY_SPELL_FILTER_STORE_KEY = 'reviewCooldownTimelineExcludedSpells';
const EXPANDED_HEIGHT_STORE_KEY = 'reviewCooldownTimelineExpandedHeight';
const CUSTOM_SCROLLBAR_HIDE_DELAY_MS = 900;
const MIN_EXPANDED_HEIGHT_PX = 160;
const MAX_DEFAULT_EXPANDED_HEIGHT_PX = 608;
const EXPANDED_HEIGHT_VIEWPORT_RATIO = 0.62;
const EXPANDED_HEIGHT_KEYBOARD_STEP_PX = 24;
const EXPANDED_TIMELINE_TOP_GAP_PX = 8;
const APP_TITLE_BAR_FALLBACK_HEIGHT_PX = 40;
const minuteTimeMarkers = computed(() => Array.from(
	{ length: Math.max(0, Math.ceil(props.fightDuration / 60_000) - 1) },
	(_, index) => (index + 1) * 60_000 / props.fightDuration,
));

type TimelineActor = {
	guid?: number;
	icon?: string;
	id?: number;
	name?: string;
	type?: string;
};

type PlayerRole = 'tank' | 'healer' | 'dps' | 'unknown';

type TimelineCooldown = {
	event: reviewCooldownEvent;
	key: string;
	percent: number;
	timestampSeconds: number;
	track: number;
};

type BossCastMarker = {
	event: reviewBossCastEvent;
	key: string;
	percent: number;
	startPercent: number;
	timestampSeconds: number;
	durationSeconds: number;
};

type BossCastLane = {
	ability: reviewBossCastAbility;
	markers: BossCastMarker[];
};

type DeathPeriod = {
	event: fightEvent;
	resurrectionEvent?: fightEvent;
	resurrectionKind?: 'player' | 'reincarnation';
	key: string;
	actorKey: string;
	id: number;
	name: string;
	className: string;
	actorIcon: string;
	spell: string;
	icon: string;
	percent: number;
	endPercent: number;
	timestampSeconds: number;
	endTimestampSeconds: number;
	resurrected: boolean;
};

type TimelineLane = {
	key: string;
	actorID?: number;
	name: string;
	className: string;
	actorIcon: string;
	role: PlayerRole;
	height: number;
	cooldowns: TimelineCooldown[];
	deathPeriods: DeathPeriod[];
};

type TimelineRow =
	| {
		kind: 'role';
		key: string;
		role: PlayerRole;
		label: string;
		count: number;
	}
	| {
		kind: 'lane';
		key: string;
		lane: TimelineLane;
		stripeIndex: number;
	};

type TimelineSpellOption = {
	spellID: number;
	name: string;
	icon: string;
	groups: reviewCooldownGroupID[];
	classNames: string[];
	castCount: number;
};

type TimelineSpellClassGroup = {
	key: string;
	className: string;
	label: string;
	options: TimelineSpellOption[];
};

type HoverContext = 'compact' | 'expanded';

type TimelineHover = {
	visible: boolean;
	context: HoverContext;
	percent: number;
	timestampSeconds: number;
	x: number;
	y: number;
};

type DetailTooltip =
	| { kind: 'cooldown'; cooldown: TimelineCooldown; x: number; y: number }
	| { kind: 'death'; death: DeathPeriod; x: number; y: number }
	| { kind: 'boss'; lane: BossCastLane; marker: BossCastMarker; occurrences: BossCastMarker[]; placement: 'above' | 'below'; x: number; y: number };

type StoredCooldownGroupPreferences = {
	knownGroupIDs: string[];
	enabledGroupIDs: string[];
};

type StoredSpellFilterPreferences = {
	mode: 'all' | 'custom';
	enabledSpellIDs: number[];
};

type CustomScrollbarState = {
	visible: boolean;
	thumbHeight: number;
	thumbTop: number;
	scrollTop: number;
	maxScroll: number;
};

const timelineHover = ref<TimelineHover>({
	visible: false,
	context: 'compact',
	percent: 0,
	timestampSeconds: 0,
	x: 0,
	y: 0,
});
const detailTooltip = ref<DetailTooltip | null>(null);
const {
	element: bossCastTooltipElement,
	tooltipStyle: bossCastTooltipStyle,
	occurrenceListStyle: bossCastOccurrenceListStyle,
	occurrenceStyle: getBossCastOccurrenceStyle,
	prepare: prepareBossCastTooltip,
	clear: clearBossCastTooltipLayout,
} = useBossCastTooltipLayout(() => (
	detailTooltip.value?.kind === 'boss' ? detailTooltip.value : null
));
const expandedTimelineAnchor = ref<HTMLElement | null>(null);
const expandedTimelinePanel = ref<HTMLElement | null>(null);
const expandedTimelineScroller = ref<HTMLElement | null>(null);
const customScrollbarTrack = ref<HTMLElement | null>(null);
const expandedTimelineHeight = ref(Math.min(
	MAX_DEFAULT_EXPANDED_HEIGHT_PX,
	Math.max(MIN_EXPANDED_HEIGHT_PX, Math.round((typeof window === 'undefined' ? 980 : window.innerHeight) * EXPANDED_HEIGHT_VIEWPORT_RATIO)),
));
const expandedTimelineMaxHeight = ref(Math.max(
	MIN_EXPANDED_HEIGHT_PX,
	(typeof window === 'undefined' ? 980 : window.innerHeight) - 16,
));
const isExpandedTimelineResizing = ref(false);
const customScrollbarState = ref<CustomScrollbarState>({
	visible: false,
	thumbHeight: 0,
	thumbTop: 0,
	scrollTop: 0,
	maxScroll: 0,
});
const isCustomScrollbarActive = ref(false);
const selectedGroupIDs = ref<reviewCooldownGroupID[]>([]);
const spellFilterMode = ref<'all' | 'custom'>('all');
const enabledSpellIDs = ref<number[]>([]);
const groupPreferencesLoaded = ref(false);
const spellPreferencesLoaded = ref(false);
const storedGroupPreferences = ref<StoredCooldownGroupPreferences | null>(null);
const isSpellFiltersExpanded = ref(false);
const isBossCastFiltersExpanded = ref(false);
const bossCastSearchQuery = ref('');
const spellSearchQuery = ref('');
const activeSpellFilterGroupID = ref<reviewCooldownGroupID | 'all'>('all');
let initializedGroupSignature = '';
let detailTooltipAnimationFrame: number | null = null;
let pendingDetailTooltipPoint: { x: number; y: number } | null = null;
let timelineHoverAnimationFrame: number | null = null;
let customScrollbarAnimationFrame: number | null = null;
let customScrollbarHideTimer: number | null = null;
let expandedScrollerResizeObserver: ResizeObserver | null = null;
let expandedTimelineResizeDrag: {
	pointerID: number;
	startClientY: number;
	lastClientY: number;
	startHeight: number;
	currentHeight: number;
	maxHeight: number;
	handle: HTMLElement;
} | null = null;
let expandedTimelineResizeAnimationFrame: number | null = null;
let resizeBodyStyles: { cursor: string; userSelect: string } | null = null;
let customScrollbarDrag: {
	pointerID: number;
	startClientY: number;
	startScrollTop: number;
} | null = null;
let pendingTimelineMove: {
	context: HoverContext;
	timeline: HTMLElement;
	clientX: number;
} | null = null;
let pendingLegacyExcludedSpellIDs: number[] | null = null;

const enabledGroups = computed(() => {
	const selectedIDs = new Set(selectedGroupIDs.value);
	return props.groups.filter(group => selectedIDs.has(group.id));
});
const enabledGroupIDs = computed(() => new Set(enabledGroups.value.map(group => group.id)));
const groupLabels = computed(() => new Map(props.groups.map(group => [group.id, group.label])));
const spellOptionSourceEvents = computed(() => (
	timelineViewMode.value === 'comparison' ? comparisonSpellEvents.value : props.events
));
const spellOptions = computed<TimelineSpellOption[]>(() => {
	const optionsBySpellID = new Map<number, TimelineSpellOption>();

	spellOptionSourceEvents.value.forEach((event) => {
		const spellID = event.cooldown.spellID;
		const className = event.source?.type?.trim() || '';
		const existingOption = optionsBySpellID.get(spellID);
		if (existingOption) {
			existingOption.castCount++;
			event.cooldown.groups.forEach((groupID) => {
				if (!existingOption.groups.includes(groupID)) existingOption.groups.push(groupID);
			});
			if (className && !existingOption.classNames.includes(className)) {
				existingOption.classNames.push(className);
			}
			if (!existingOption.icon && event.ability?.abilityIcon) {
				existingOption.icon = event.ability.abilityIcon;
			}
			return;
		}

		optionsBySpellID.set(spellID, {
			spellID,
			name: event.ability?.name || `Spell ${spellID}`,
			icon: event.ability?.abilityIcon || '',
			groups: [...event.cooldown.groups],
			classNames: className ? [className] : [],
			castCount: 1,
		});
	});

	return [...optionsBySpellID.values()]
		.map(option => ({
			...option,
			classNames: option.classNames.sort((left, right) => left.localeCompare(right)),
		}))
		.sort((left, right) => (
			getSpellClassSortLabel(left).localeCompare(getSpellClassSortLabel(right))
			|| left.name.localeCompare(right.name)
			|| left.spellID - right.spellID
		));
});
const enabledSpellIDSet = computed(() => new Set(enabledSpellIDs.value));
const excludedSpellIDs = computed(() => (
	spellFilterMode.value === 'all'
		? []
		: spellOptions.value
			.filter(option => !enabledSpellIDSet.value.has(option.spellID))
			.map(option => option.spellID)
));
const excludedSpellIDSet = computed(() => new Set(excludedSpellIDs.value));
const filteredSpellOptions = computed(() => {
	const normalizedQuery = spellSearchQuery.value.trim().toLowerCase();
	return spellOptions.value.filter((option) => (
		(activeSpellFilterGroupID.value === 'all' || option.groups.includes(activeSpellFilterGroupID.value))
		&& (
			!normalizedQuery
			|| option.name.toLowerCase().includes(normalizedQuery)
			|| option.spellID.toString().includes(normalizedQuery)
			|| option.classNames.some(className => formatClassName(className).toLowerCase().includes(normalizedQuery))
		)
	));
});
const filteredSpellOptionGroups = computed<TimelineSpellClassGroup[]>(() => {
	const groupsByClass = new Map<string, TimelineSpellClassGroup>();

	filteredSpellOptions.value.forEach((option) => {
		const className = option.classNames.length === 1 ? option.classNames[0] : '';
		const key = option.classNames.length > 1
			? '__multiple_classes'
			: className || '__other';
		let group = groupsByClass.get(key);
		if (!group) {
			group = {
				key,
				className,
				label: option.classNames.length > 1 ? 'Multiple classes' : formatClassName(className),
				options: [],
			};
			groupsByClass.set(key, group);
		}
		group.options.push(option);
	});

	return [...groupsByClass.values()]
		.sort((left, right) => (
			getSpellClassGroupSortOrder(left.key) - getSpellClassGroupSortOrder(right.key)
			|| left.label.localeCompare(right.label)
		));
});
const visibleSpellCount = computed(() => (
	spellOptions.value.filter(option => !excludedSpellIDSet.value.has(option.spellID)).length
));
const spellCountByGroup = computed(() => {
	const counts = new Map<reviewCooldownGroupID, number>();
	props.groups.forEach(group => counts.set(group.id, 0));
	spellOptions.value.forEach((option) => {
		option.groups.forEach(groupID => counts.set(groupID, (counts.get(groupID) || 0) + 1));
	});
	return counts;
});
const visiblePhases = computed(() => props.phases.filter(phase => phase.percent > 0 && phase.percent < 1));
const selectedFight = computed(() => reviewsStore.getSelectedFight);
const selectedBossCastData = computed(() => {
	const reportCode = reviewsStore.selectedReportCode;
	const fightID = reviewsStore.selectedFightID;
	return reportCode && fightID
		? reviewsStore.getFightBossCastDataFor(reportCode, fightID)
		: null;
});
const bossCastAbilities = computed(() => {
	const data = selectedBossCastData.value;
	return data
		? sortBossCastAbilitiesByFirstOccurrence(data.abilities, data.bossCastEvents)
		: [];
});
const bossCastInterruptsIncomplete = computed(() => (
	selectedBossCastData.value?.interruptsComplete === false
));
const visibleBossCastAbilityCount = computed(() => {
	const fight = selectedFight.value;
	if (!fight) return 0;
	return bossCastAbilities.value.filter(ability => (
		reviewsStore.isBossCastAbilityEnabled(fight.encounterID, fight.difficulty, ability)
	)).length;
});
const filteredBossCastAbilities = computed(() => {
	const query = bossCastSearchQuery.value.trim().toLowerCase();
	if (!query) return bossCastAbilities.value;
	return bossCastAbilities.value.filter(ability => (
		ability.name.toLowerCase().includes(query)
		|| ability.spellID.toString().includes(query)
		|| ability.sources.some(source => source.name.toLowerCase().includes(query))
	));
});
const bossCastLanes = computed<BossCastLane[]>(() => {
	const data = selectedBossCastData.value;
	const fight = selectedFight.value;
	if (!data || !fight || props.fightDuration <= 0 || !reviewsStore.bossCastPreferencesLoaded) return [];

	const enabledAbilities = bossCastAbilities.value.filter(ability => (
		reviewsStore.isBossCastAbilityEnabled(fight.encounterID, fight.difficulty, ability)
	));
	const eventsBySpellID = new Map<number, BossCastMarker[]>();
	data.bossCastEvents.forEach((event, index) => {
		const relativeTime = event.timestamp - props.fightStartTime;
		if (relativeTime < 0 || relativeTime > props.fightDuration) return;
		const percent = relativeTime / props.fightDuration;
		const startRelativeTime = event.bossCast.startTimestamp == null
			? relativeTime
			: event.bossCast.startTimestamp - props.fightStartTime;
		const marker: BossCastMarker = {
			event,
			key: `boss:${event.bossCast.spellID}:${event.timestamp}:${event.source?.id || 0}:${index}`,
			percent,
			startPercent: Math.max(0, Math.min(percent, startRelativeTime / props.fightDuration)),
			timestampSeconds: relativeTime / 1000,
			durationSeconds: Math.max(0, relativeTime - startRelativeTime) / 1000,
		};
		const markers = eventsBySpellID.get(event.bossCast.spellID) || [];
		markers.push(marker);
		eventsBySpellID.set(event.bossCast.spellID, markers);
	});

	return enabledAbilities
		.map(ability => ({
			ability,
			markers: eventsBySpellID.get(ability.spellID) || [],
		}))
		.filter(lane => lane.markers.length > 0);
});
const collapsedBossCastMarkers = computed(() => {
	return buildCollapsedBossCastMarkers(bossCastLanes.value);
});
const collapsedBossCastDurationMarkers = computed(() => (
	collapsedBossCastMarkers.value.flatMap(item => item.occurrences)
));
const fullBossCastLanes = computed(() => bossCastLanes.value.map(lane => ({
	...lane,
	markerGroups: buildCollapsedBossCastMarkers([lane]),
})));
const isBossCastsLoading = computed(() => {
	const reportCode = reviewsStore.selectedReportCode;
	const fightID = reviewsStore.selectedFightID;
	return Boolean(reportCode && fightID && reviewsStore.isFightBossCastsLoadingFor(reportCode, fightID));
});
const bossCastError = computed(() => {
	const reportCode = reviewsStore.selectedReportCode;
	const fightID = reviewsStore.selectedFightID;
	return reportCode && fightID
		? reviewsStore.getFightBossCastErrorFor(reportCode, fightID)
		: null;
});
const ROLE_SORT_ORDER: Record<PlayerRole, number> = {
	tank: 0,
	healer: 1,
	dps: 2,
	unknown: 3,
};
const ROLE_LABELS: Record<PlayerRole, string> = {
	tank: 'Tanks',
	healer: 'Healers',
	dps: 'Damage',
	unknown: 'Other',
};
const TANK_SPECS = new Set(['blood', 'brewmaster', 'guardian', 'protection', 'vengeance']);
const HEALER_SPECS = new Set(['discipline', 'holy', 'mistweaver', 'preservation', 'restoration']);

function parseStoredGroupPreferences(value: unknown): StoredCooldownGroupPreferences | null {
	if (!value || typeof value !== 'object') return null;

	const candidate = value as Partial<StoredCooldownGroupPreferences>;
	if (!Array.isArray(candidate.knownGroupIDs) || !Array.isArray(candidate.enabledGroupIDs)) return null;
	return {
		knownGroupIDs: candidate.knownGroupIDs.filter((id): id is string => typeof id === 'string'),
		enabledGroupIDs: candidate.enabledGroupIDs.filter((id): id is string => typeof id === 'string'),
	};
}

function parseStoredSpellIDs(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((spellID): spellID is number => (
		typeof spellID === 'number'
		&& Number.isInteger(spellID)
		&& spellID > 0
	)))];
}

function parseStoredSpellPreferences(value: unknown): StoredSpellFilterPreferences | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSpellFilterPreferences>;
	if (
		(candidate.mode !== 'all' && candidate.mode !== 'custom')
		|| !Array.isArray(candidate.enabledSpellIDs)
	) return null;
	return {
		mode: candidate.mode,
		enabledSpellIDs: parseStoredSpellIDs(candidate.enabledSpellIDs),
	};
}

function initializeGroupSelection() {
	if (props.groups.length === 0) {
		// Fight changes briefly expose an empty cooldown payload while the next
		// request is loading. Preserve the current selection until real group
		// metadata arrives so a same-catalog fight does not appear to reset it.
		return;
	}

	if (!groupPreferencesLoaded.value) {
		selectedGroupIDs.value = props.groups
			.filter(group => group.defaultEnabled)
			.map(group => group.id);
		return;
	}

	const groupSignature = props.groups
		.map(group => `${group.id}:${group.defaultEnabled ? 1 : 0}`)
		.join('|');
	if (groupSignature === initializedGroupSignature) return;

	const preferences = storedGroupPreferences.value;
	const knownIDs = new Set(preferences?.knownGroupIDs || []);
	const enabledIDs = new Set(preferences?.enabledGroupIDs || []);
	selectedGroupIDs.value = props.groups
		.filter(group => (
			preferences && knownIDs.has(group.id)
				? enabledIDs.has(group.id)
				: group.defaultEnabled
		))
		.map(group => group.id);
	initializedGroupSignature = groupSignature;
}

function persistGroupSelection() {
	const preferences: StoredCooldownGroupPreferences = {
		knownGroupIDs: props.groups.map(group => group.id),
		enabledGroupIDs: [...selectedGroupIDs.value],
	};
	storedGroupPreferences.value = preferences;
	store.set(GROUP_FILTER_STORE_KEY, preferences).catch((error: unknown) => {
		log.error('Failed to persist review cooldown group filters', error);
	});
}

function setEnabledGroupIDs(groupIDs: readonly reviewCooldownGroupID[]) {
	const requestedIDs = new Set(groupIDs);
	selectedGroupIDs.value = props.groups
		.filter(group => requestedIDs.has(group.id))
		.map(group => group.id);
	persistGroupSelection();
}

function toggleGroup(groupID: reviewCooldownGroupID) {
	const nextGroupIDs = new Set(selectedGroupIDs.value);
	if (nextGroupIDs.has(groupID)) {
		nextGroupIDs.delete(groupID);
	} else {
		nextGroupIDs.add(groupID);
	}
	setEnabledGroupIDs([...nextGroupIDs]);
}

function enableAllGroups() {
	setEnabledGroupIDs(props.groups.map(group => group.id));
}

function disableAllGroups() {
	setEnabledGroupIDs([]);
}

function restoreDefaultGroups() {
	setEnabledGroupIDs(
		props.groups
			.filter(group => group.defaultEnabled)
			.map(group => group.id),
	);
}

function persistSpellPreferences() {
	const preferences: StoredSpellFilterPreferences = {
		mode: spellFilterMode.value,
		enabledSpellIDs: [...enabledSpellIDs.value],
	};
	store.set(SPELL_FILTER_STORE_KEY, preferences).catch((error: unknown) => {
		log.error('Failed to persist review cooldown spell filters', error);
	});
}

function toggleSpell(spellID: number) {
	let nextEnabledSpellIDs: Set<number>;
	if (spellFilterMode.value === 'all') {
		nextEnabledSpellIDs = new Set(spellOptions.value.map(option => option.spellID));
		nextEnabledSpellIDs.delete(spellID);
		spellFilterMode.value = 'custom';
	} else {
		nextEnabledSpellIDs = new Set(enabledSpellIDs.value);
		if (nextEnabledSpellIDs.has(spellID)) {
			nextEnabledSpellIDs.delete(spellID);
		} else {
			nextEnabledSpellIDs.add(spellID);
		}
	}
	enabledSpellIDs.value = [...nextEnabledSpellIDs].sort((left, right) => left - right);
	persistSpellPreferences();
}

function showAllSpells() {
	spellFilterMode.value = 'all';
	enabledSpellIDs.value = [];
	persistSpellPreferences();
}

function isBossCastAbilityVisible(ability: reviewBossCastAbility) {
	const fight = selectedFight.value;
	return Boolean(fight && reviewsStore.isBossCastAbilityEnabled(
		fight.encounterID,
		fight.difficulty,
		ability,
	));
}

function toggleBossCastAbility(ability: reviewBossCastAbility) {
	const fight = selectedFight.value;
	if (!fight) return;
	void reviewsStore.setBossCastAbilityEnabled(
		fight.encounterID,
		fight.difficulty,
		ability.spellID,
		!isBossCastAbilityVisible(ability),
	);
}

function restoreDefaultBossCasts() {
	const fight = selectedFight.value;
	if (!fight) return;
	void reviewsStore.resetBossCastAbilityPreferences(fight.encounterID, fight.difficulty);
}

function retrySelectedBossCasts() {
	const reportCode = reviewsStore.selectedReportCode;
	const fightID = reviewsStore.selectedFightID;
	if (!reportCode || !fightID) return;
	void reviewsStore.ensureFightBossCasts(reportCode, fightID, true);
}

function setBossCastDisplayMode(mode: 'full' | 'collapsed') {
	void reviewsStore.setBossCastDisplayMode(mode);
}

function finishLegacySpellPreferenceMigration() {
	if (pendingLegacyExcludedSpellIDs == null) return;
	if (props.loading && spellOptions.value.length === 0) return;

	const legacyExcludedSpellIDSet = new Set(pendingLegacyExcludedSpellIDs);
	spellFilterMode.value = legacyExcludedSpellIDSet.size === 0 ? 'all' : 'custom';
	enabledSpellIDs.value = spellFilterMode.value === 'all'
		? []
		: spellOptions.value
			.filter(option => !legacyExcludedSpellIDSet.has(option.spellID))
			.map(option => option.spellID)
			.sort((left, right) => left - right);
	pendingLegacyExcludedSpellIDs = null;
	spellPreferencesLoaded.value = true;
	persistSpellPreferences();
}

function getGroupIndicatorColor(groupID: reviewCooldownGroupID) {
	switch (groupID) {
		case 'deaths': return 'bg-red-500';
		case 'raid_cd': return 'bg-cyan-400';
		case 'personals': return 'bg-violet-400';
		case 'externals': return 'bg-pink-400';
		case 'utility': return 'bg-blue-400';
		case 'movement': return 'bg-emerald-400';
		case 'dps_cd': return 'bg-amber-400';
		case 'interrupts': return 'bg-lime-400';
		case 'taunts': return 'bg-yellow-300';
		case 'aoe_cc': return 'bg-orange-400';
		case 'single_cc': return 'bg-red-400';
	}
}

function updateCustomScrollbar() {
	if (isExpandedTimelineResizing.value) return;
	const scroller = expandedTimelineScroller.value;
	const track = customScrollbarTrack.value;
	if (!scroller || !track) {
		clearCustomScrollbarHideTimer();
		isCustomScrollbarActive.value = false;
		customScrollbarState.value = {
			visible: false,
			thumbHeight: 0,
			thumbTop: 0,
			scrollTop: 0,
			maxScroll: 0,
		};
		return;
	}

	const trackHeight = track.clientHeight;
	const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
	const visible = maxScroll > 1 && trackHeight > 0;
	const thumbHeight = visible
		? Math.min(trackHeight, Math.max(36, trackHeight * scroller.clientHeight / scroller.scrollHeight))
		: trackHeight;
	const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
	const scrollTop = Math.max(0, Math.min(maxScroll, scroller.scrollTop));
	const thumbTop = maxScroll > 0 ? scrollTop / maxScroll * maxThumbTop : 0;

	customScrollbarState.value = {
		visible,
		thumbHeight,
		thumbTop,
		scrollTop,
		maxScroll,
	};
	if (!visible) {
		clearCustomScrollbarHideTimer();
		isCustomScrollbarActive.value = false;
	}
}

function scheduleCustomScrollbarUpdate() {
	if (isExpandedTimelineResizing.value) return;
	if (customScrollbarAnimationFrame != null) return;
	customScrollbarAnimationFrame = window.requestAnimationFrame(() => {
		customScrollbarAnimationFrame = null;
		updateCustomScrollbar();
	});
}

function clearCustomScrollbarHideTimer() {
	if (customScrollbarHideTimer == null) return;
	window.clearTimeout(customScrollbarHideTimer);
	customScrollbarHideTimer = null;
}

function revealCustomScrollbar(autoHide = true) {
	if (!customScrollbarState.value.visible) return;
	clearCustomScrollbarHideTimer();
	isCustomScrollbarActive.value = true;
	if (!autoHide) return;

	customScrollbarHideTimer = window.setTimeout(() => {
		customScrollbarHideTimer = null;
		if (!customScrollbarDrag) isCustomScrollbarActive.value = false;
	}, CUSTOM_SCROLLBAR_HIDE_DELAY_MS);
}

function onCustomScrollbarScroll() {
	scheduleCustomScrollbarUpdate();
	revealCustomScrollbar(!customScrollbarDrag);
}

function setCustomScrollbarThumbTop(thumbTop: number) {
	const scroller = expandedTimelineScroller.value;
	const track = customScrollbarTrack.value;
	if (!scroller || !track) return;

	const maxThumbTop = Math.max(0, track.clientHeight - customScrollbarState.value.thumbHeight);
	const clampedThumbTop = Math.max(0, Math.min(maxThumbTop, thumbTop));
	scroller.scrollTop = maxThumbTop > 0
		? clampedThumbTop / maxThumbTop * customScrollbarState.value.maxScroll
		: 0;
}

function onCustomScrollbarTrackPointerDown(event: PointerEvent) {
	if (event.button !== 0 || !customScrollbarState.value.visible) return;
	const track = customScrollbarTrack.value;
	if (!track) return;

	event.preventDefault();
	revealCustomScrollbar();
	const trackRect = track.getBoundingClientRect();
	setCustomScrollbarThumbTop(
		event.clientY - trackRect.top - customScrollbarState.value.thumbHeight / 2,
	);
}

function onCustomScrollbarThumbPointerDown(event: PointerEvent) {
	if (event.button !== 0) return;
	event.preventDefault();
	const thumb = event.currentTarget as HTMLElement;
	thumb.setPointerCapture(event.pointerId);
	revealCustomScrollbar(false);
	customScrollbarDrag = {
		pointerID: event.pointerId,
		startClientY: event.clientY,
		startScrollTop: customScrollbarState.value.thumbTop,
	};
}

function onCustomScrollbarThumbPointerMove(event: PointerEvent) {
	if (!customScrollbarDrag || customScrollbarDrag.pointerID !== event.pointerId) return;
	event.preventDefault();
	setCustomScrollbarThumbTop(
		customScrollbarDrag.startScrollTop + event.clientY - customScrollbarDrag.startClientY,
	);
}

function onCustomScrollbarThumbPointerEnd(event: PointerEvent) {
	if (!customScrollbarDrag || customScrollbarDrag.pointerID !== event.pointerId) return;
	const thumb = event.currentTarget as HTMLElement;
	if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
	customScrollbarDrag = null;
	revealCustomScrollbar();
}

function onCustomScrollbarKeydown(event: KeyboardEvent) {
	const scroller = expandedTimelineScroller.value;
	if (!scroller || !customScrollbarState.value.visible) return;

	let nextScrollTop = scroller.scrollTop;
	switch (event.key) {
		case 'ArrowUp': nextScrollTop -= 36; break;
		case 'ArrowDown': nextScrollTop += 36; break;
		case 'PageUp': nextScrollTop -= scroller.clientHeight * 0.9; break;
		case 'PageDown': nextScrollTop += scroller.clientHeight * 0.9; break;
		case 'Home': nextScrollTop = 0; break;
		case 'End': nextScrollTop = customScrollbarState.value.maxScroll; break;
		default: return;
	}
	event.preventDefault();
	scroller.scrollTop = nextScrollTop;
	revealCustomScrollbar();
}

function getExpandedTimelineAvailableHeight() {
	const viewportHeight = window.innerHeight;
	const panelBottom = expandedTimelinePanel.value?.getBoundingClientRect().bottom;
	const titleBarBottom = document.querySelector<HTMLElement>('[data-app-title-bar]')
		?.getBoundingClientRect().bottom ?? APP_TITLE_BAR_FALLBACK_HEIGHT_PX;
	const minimumPanelTop = Math.max(
		EXPANDED_TIMELINE_TOP_GAP_PX,
		titleBarBottom + EXPANDED_TIMELINE_TOP_GAP_PX,
	);
	return Math.max(
		MIN_EXPANDED_HEIGHT_PX,
		Math.floor(Math.min(
			viewportHeight - minimumPanelTop,
			(panelBottom ?? viewportHeight) - minimumPanelTop,
		)),
	);
}

function setExpandedTimelineHeight(height: number) {
	if (props.detached) {
		scheduleCustomScrollbarUpdate();
		return;
	}
	const maxHeight = getExpandedTimelineAvailableHeight();
	expandedTimelineMaxHeight.value = maxHeight;
	expandedTimelineHeight.value = Math.round(Math.max(
		MIN_EXPANDED_HEIGHT_PX,
		Math.min(maxHeight, height),
	));
	scheduleCustomScrollbarUpdate();
}

function parseStoredExpandedTimelineHeight(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= MIN_EXPANDED_HEIGHT_PX
		? Math.round(value)
		: null;
}

function persistExpandedTimelineHeight() {
	store.set(EXPANDED_HEIGHT_STORE_KEY, expandedTimelineHeight.value).catch((error: unknown) => {
		log.error('Failed to persist review cooldown timeline height', error);
	});
}

function restoreResizeBodyStyles() {
	if (!resizeBodyStyles) return;
	document.body.style.cursor = resizeBodyStyles.cursor;
	document.body.style.userSelect = resizeBodyStyles.userSelect;
	resizeBodyStyles = null;
}

function applyPendingExpandedTimelineResize() {
	expandedTimelineResizeAnimationFrame = null;
	const drag = expandedTimelineResizeDrag;
	const panel = expandedTimelinePanel.value;
	if (!drag || !panel) return;
	panel.style.setProperty('--review-expanded-timeline-drag-height', `${drag.currentHeight}px`);
}

function scheduleExpandedTimelineResize() {
	if (expandedTimelineResizeAnimationFrame != null) return;
	expandedTimelineResizeAnimationFrame = window.requestAnimationFrame(applyPendingExpandedTimelineResize);
}

function finishExpandedTimelineResize(pointerID?: number) {
	const drag = expandedTimelineResizeDrag;
	if (!drag || (pointerID != null && drag.pointerID !== pointerID)) return;
	if (expandedTimelineResizeAnimationFrame != null) {
		window.cancelAnimationFrame(expandedTimelineResizeAnimationFrame);
		expandedTimelineResizeAnimationFrame = null;
	}
	const panel = expandedTimelinePanel.value;
	if (panel) {
		panel.style.height = `${drag.currentHeight}px`;
		panel.style.removeProperty('--review-expanded-timeline-drag-height');
		panel.style.willChange = '';
	}
	expandedTimelineResizeDrag = null;
	if (drag.handle.hasPointerCapture(drag.pointerID)) {
		drag.handle.releasePointerCapture(drag.pointerID);
	}
	isExpandedTimelineResizing.value = false;
	expandedTimelineMaxHeight.value = drag.maxHeight;
	expandedTimelineHeight.value = drag.currentHeight;
	restoreResizeBodyStyles();
	persistExpandedTimelineHeight();
	void nextTick(scheduleCustomScrollbarUpdate);
}

function onExpandedTimelineResizePointerDown(event: PointerEvent) {
	if (event.button !== 0) return;
	const panel = expandedTimelinePanel.value;
	if (!panel) return;

	event.preventDefault();
	const handle = event.currentTarget as HTMLElement;
	handle.setPointerCapture(event.pointerId);
	const maxHeight = getExpandedTimelineAvailableHeight();
	const startHeight = Math.round(Math.max(
		MIN_EXPANDED_HEIGHT_PX,
		Math.min(maxHeight, panel.getBoundingClientRect().height),
	));
	expandedTimelineMaxHeight.value = maxHeight;
	expandedTimelineHeight.value = startHeight;
	expandedTimelineResizeDrag = {
		pointerID: event.pointerId,
		startClientY: event.clientY,
		lastClientY: event.clientY,
		startHeight,
		currentHeight: startHeight,
		maxHeight,
		handle,
	};
	isExpandedTimelineResizing.value = true;
	panel.style.setProperty('--review-expanded-timeline-drag-height', `${startHeight}px`);
	panel.style.height = 'var(--review-expanded-timeline-drag-height)';
	panel.style.willChange = 'height';
	resizeBodyStyles = {
		cursor: document.body.style.cursor,
		userSelect: document.body.style.userSelect,
	};
	document.body.style.cursor = 'ns-resize';
	document.body.style.userSelect = 'none';
}

function onExpandedTimelineResizePointerMove(event: PointerEvent) {
	const drag = expandedTimelineResizeDrag;
	if (!drag || drag.pointerID !== event.pointerId) return;
	event.preventDefault();
	drag.lastClientY = event.clientY;
	drag.currentHeight = Math.round(Math.max(
		MIN_EXPANDED_HEIGHT_PX,
		Math.min(drag.maxHeight, drag.startHeight + drag.startClientY - event.clientY),
	));
	scheduleExpandedTimelineResize();
}

function onExpandedTimelineResizePointerEnd(event: PointerEvent) {
	finishExpandedTimelineResize(event.pointerId);
}

function onExpandedTimelineResizeKeydown(event: KeyboardEvent) {
	let nextHeight = expandedTimelineHeight.value;
	switch (event.key) {
		case 'ArrowUp': nextHeight += EXPANDED_HEIGHT_KEYBOARD_STEP_PX; break;
		case 'ArrowDown': nextHeight -= EXPANDED_HEIGHT_KEYBOARD_STEP_PX; break;
		case 'Home': nextHeight = MIN_EXPANDED_HEIGHT_PX; break;
		case 'End': nextHeight = getExpandedTimelineAvailableHeight(); break;
		default: return;
	}
	event.preventDefault();
	setExpandedTimelineHeight(nextHeight);
	persistExpandedTimelineHeight();
}

function onWindowResize() {
	if (props.detached) {
		scheduleCustomScrollbarUpdate();
		return;
	}
	if (!isExpanded.value) return;
	const drag = expandedTimelineResizeDrag;
	if (drag) {
		drag.maxHeight = getExpandedTimelineAvailableHeight();
		drag.currentHeight = Math.round(Math.max(
			MIN_EXPANDED_HEIGHT_PX,
			Math.min(drag.maxHeight, drag.currentHeight),
		));
		drag.startHeight = drag.currentHeight;
		drag.startClientY = drag.lastClientY;
		expandedTimelineMaxHeight.value = drag.maxHeight;
		scheduleExpandedTimelineResize();
		return;
	}
	setExpandedTimelineHeight(expandedTimelineHeight.value);
}

onMounted(async () => {
	try {
		storedGroupPreferences.value = parseStoredGroupPreferences(
			await store.get(GROUP_FILTER_STORE_KEY),
		);
	} catch (error) {
		log.error('Failed to load review cooldown group filters', error);
		storedGroupPreferences.value = null;
	} finally {
		groupPreferencesLoaded.value = true;
		initializeGroupSelection();
	}
});

onMounted(async () => {
	try {
		const storedPreferences = parseStoredSpellPreferences(
			await store.get(SPELL_FILTER_STORE_KEY),
		);
		if (storedPreferences) {
			spellFilterMode.value = storedPreferences.mode;
			enabledSpellIDs.value = storedPreferences.enabledSpellIDs;
			spellPreferencesLoaded.value = true;
			return;
		}

		pendingLegacyExcludedSpellIDs = parseStoredSpellIDs(
			await store.get(LEGACY_SPELL_FILTER_STORE_KEY),
		);
		finishLegacySpellPreferenceMigration();
	} catch (error) {
		log.error('Failed to load review cooldown spell filters', error);
		spellFilterMode.value = 'all';
		enabledSpellIDs.value = [];
		spellPreferencesLoaded.value = true;
	}
});

onMounted(async () => {
	window.addEventListener('resize', onWindowResize);
	try {
		const storedHeight = parseStoredExpandedTimelineHeight(
			await store.get(EXPANDED_HEIGHT_STORE_KEY),
		);
		if (storedHeight != null) expandedTimelineHeight.value = storedHeight;
	} catch (error) {
		log.error('Failed to load review cooldown timeline height', error);
	}

	if (isExpanded.value && !props.detached) {
		await nextTick();
		setExpandedTimelineHeight(expandedTimelineHeight.value);
	}
});

watch(() => props.groups, initializeGroupSelection, { deep: true, immediate: true });
watch([spellOptions, () => props.loading], finishLegacySpellPreferenceMigration);
watch(
	[
		isExpanded,
		timelineViewMode,
		() => reviewsStore.selectedReportCode,
		() => reviewsStore.selectedFightID,
		() => reviewsStore.fightBossCastCacheEpoch,
	],
	([expanded, viewMode, reportCode, fightID]) => {
		if (!expanded || viewMode !== 'fight' || !reportCode || !fightID) return;
		void reviewsStore.ensureBossCastPreferencesLoaded();
		void reviewsStore.ensureFightBossCasts(reportCode, fightID);
	},
	{ immediate: true },
);
watch(() => props.groups.map(group => group.id), (groupIDs) => {
	if (
		activeSpellFilterGroupID.value !== 'all'
		&& !groupIDs.includes(activeSpellFilterGroupID.value)
	) {
		activeSpellFilterGroupID.value = 'all';
	}
});
watch(expandedTimelineScroller, (scroller) => {
	expandedScrollerResizeObserver?.disconnect();
	expandedScrollerResizeObserver = null;
	customScrollbarDrag = null;
	if (!scroller) {
		scheduleCustomScrollbarUpdate();
		return;
	}

	expandedScrollerResizeObserver = new ResizeObserver(scheduleCustomScrollbarUpdate);
	expandedScrollerResizeObserver.observe(scroller);
	void nextTick(scheduleCustomScrollbarUpdate);
}, { flush: 'post' });
watch(isExpanded, (expanded) => {
	if (!expanded) {
		finishExpandedTimelineResize();
		return;
	}
	if (!props.detached) void nextTick(() => setExpandedTimelineHeight(expandedTimelineHeight.value));
}, { flush: 'post' });

function formatTime(seconds: number) {
	const safeSeconds = Math.max(0, seconds);
	const minutes = Math.floor(safeSeconds / 60);
	const remainingSeconds = Math.floor(safeSeconds % 60);
	return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatEventTime(seconds: number) {
	const roundedTenths = Math.round(Math.max(0, seconds) * 10);
	const minutes = Math.floor(roundedTenths / 600);
	const remainingTenths = roundedTenths % 600;
	const remainingSeconds = (remainingTenths / 10).toFixed(1).padStart(4, '0');
	return `${minutes}:${remainingSeconds}`;
}

function getPhaseTimeLabel(timestampSeconds: number) {
	if (props.fightDuration <= 0) return '';

	const eventPercent = timestampSeconds * 1000 / props.fightDuration;
	const currentPhase = visiblePhases.value.reduce<reviewPhaseMarker | null>((latestPhase, phase) => {
		if (phase.percent > eventPercent) return latestPhase;
		if (!latestPhase || phase.percent > latestPhase.percent) return phase;
		return latestPhase;
	}, null);
	if (!currentPhase) return '';

	const phaseStartSeconds = currentPhase.percent * props.fightDuration / 1000;
	return `${currentPhase.name} ${formatEventTime(timestampSeconds - phaseStartSeconds)}`;
}

function formatCooldownTimestamp(timestampSeconds: number) {
	const phaseTimeLabel = getPhaseTimeLabel(timestampSeconds);
	return phaseTimeLabel
		? `${formatEventTime(timestampSeconds)} · ${phaseTimeLabel}`
		: formatEventTime(timestampSeconds);
}

function formatDuration(seconds: number) {
	if (seconds < 60) return `${Math.max(0, seconds).toFixed(1)}s`;
	return formatTime(seconds);
}

function getBossCastOccurrenceSpan(occurrences: BossCastMarker[]) {
	if (occurrences.length < 2) return 0;
	return Math.max(0, occurrences.at(-1)!.timestampSeconds - occurrences[0].timestampSeconds);
}

function getBossCastInterruptCount(occurrences: BossCastMarker[]) {
	return occurrences.filter(occurrence => occurrence.event.bossCast.interrupt != null).length;
}

function getBossCastMarkerClass(occurrences: BossCastMarker[]) {
	const interruptCount = getBossCastInterruptCount(occurrences);
	if (interruptCount === 0) return 'border-amber-400/70 hover:border-amber-200';
	if (interruptCount === occurrences.length) return 'border-emerald-400/90 hover:border-emerald-200';
	return 'border-amber-400/70 ring-1 ring-inset ring-emerald-400/90 hover:border-amber-200';
}

function getBossCastDurationClass(marker: BossCastMarker) {
	return marker.event.bossCast.interrupt
		? 'review-boss-cast-rail--interrupted'
		: 'review-boss-cast-rail--completed';
}

function formatClassName(className?: string) {
	if (!className) return 'Other';
	return className.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function getSpellClassSortLabel(option: TimelineSpellOption) {
	if (option.classNames.length === 1) return `0:${formatClassName(option.classNames[0])}`;
	if (option.classNames.length > 1) return '1:Multiple classes';
	return '2:Other';
}

function getSpellClassGroupSortOrder(key: string) {
	if (key === '__multiple_classes') return 1;
	if (key === '__other') return 2;
	return 0;
}

function getClassTextColor(className?: string) {
	switch (className?.toLowerCase()) {
		case 'deathknight': return 'text-[#C41E3A]';
		case 'demonhunter': return 'text-[#A330C9]';
		case 'druid': return 'text-[#FF7C0A]';
		case 'evoker': return 'text-[#33937F]';
		case 'hunter': return 'text-[#AAD372]';
		case 'mage': return 'text-[#3FC7EB]';
		case 'monk': return 'text-[#00FF98]';
		case 'paladin': return 'text-[#F48CBA]';
		case 'priest': return 'text-white';
		case 'rogue': return 'text-[#FFF468]';
		case 'shaman': return 'text-[#0070DD]';
		case 'warlock': return 'text-[#8788EE]';
		case 'warrior': return 'text-[#C69B6D]';
		default: return 'text-inherit';
	}
}

function getClassAccentColor(className?: string) {
	switch (className?.toLowerCase()) {
		case 'deathknight': return 'bg-[#C41E3A]';
		case 'demonhunter': return 'bg-[#A330C9]';
		case 'druid': return 'bg-[#FF7C0A]';
		case 'evoker': return 'bg-[#33937F]';
		case 'hunter': return 'bg-[#AAD372]';
		case 'mage': return 'bg-[#3FC7EB]';
		case 'monk': return 'bg-[#00FF98]';
		case 'paladin': return 'bg-[#F48CBA]';
		case 'priest': return 'bg-white';
		case 'rogue': return 'bg-[#FFF468]';
		case 'shaman': return 'bg-[#0070DD]';
		case 'warlock': return 'bg-[#8788EE]';
		case 'warrior': return 'bg-[#C69B6D]';
		default: return 'bg-neutral-500';
	}
}

function getRoleHeaderColor(_role: PlayerRole) {
	return 'border-neutral-500/25 bg-neutral-500/[0.07] text-neutral-600 dark:text-neutral-300';
}

function getGroupBorderColor(groupID: reviewCooldownGroupID) {
	switch (groupID) {
		case 'deaths': return 'border-red-500';
		case 'raid_cd': return 'border-cyan-400';
		case 'personals': return 'border-violet-400';
		case 'externals': return 'border-pink-400';
		case 'utility': return 'border-blue-400';
		case 'movement': return 'border-emerald-400';
		case 'dps_cd': return 'border-amber-400';
		case 'interrupts': return 'border-lime-400';
		case 'taunts': return 'border-yellow-300';
		case 'aoe_cc': return 'border-orange-400';
		case 'single_cc': return 'border-red-400';
	}
}

function getCooldownBorderColor(event: reviewCooldownEvent) {
	const displayedGroup = event.cooldown.groups.find(groupID => enabledGroupIDs.value.has(groupID))
		|| event.cooldown.primaryGroup;
	return getGroupBorderColor(displayedGroup);
}

function getSpellIconURL(icon?: string) {
	if (!icon) return '';
	if (/^https?:\/\//i.test(icon)) return icon;
	return `https://wow.zamimg.com/images/wow/icons/large/${icon.toLowerCase()}`;
}

function getActorSpecIconURL(icon?: string) {
	if (!icon) return '';
	if (/^https?:\/\//i.test(icon)) return icon;
	return `https://assets.rpglogs.com/img/warcraft/icons/${encodeURIComponent(icon)}.jpg`;
}

function getActorSpecName(icon?: string) {
	const specName = icon?.split('-').at(-1) || '';
	return specName.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Unknown specialization';
}

function getActorKey(actor?: TimelineActor) {
	if (actor?.id != null) return `id:${actor.id}`;
	if (actor?.guid != null) return `guid:${actor.guid}`;
	return `name:${actor?.name || 'Unknown player'}`;
}

function getActorRole(actor?: TimelineActor): PlayerRole {
	const iconParts = actor?.icon?.split('-') || [];
	if (iconParts.length < 2) return 'unknown';

	const specName = iconParts.at(-1)?.toLowerCase() || '';
	if (TANK_SPECS.has(specName)) return 'tank';
	if (HEALER_SPECS.has(specName)) return 'healer';
	return 'dps';
}

function getTooltipPoint(event: MouseEvent) {
	const edgePadding = Math.min(150, Math.max(8, window.innerWidth / 2));
	return {
		x: Math.max(edgePadding, Math.min(window.innerWidth - edgePadding, event.clientX)),
		y: Math.max(100, event.clientY - 12),
	};
}

function cancelDetailTooltipPositionUpdate() {
	pendingDetailTooltipPoint = null;
	if (detailTooltipAnimationFrame != null) {
		window.cancelAnimationFrame(detailTooltipAnimationFrame);
		detailTooltipAnimationFrame = null;
	}
}

function updateDetailTooltipPosition(event: MouseEvent) {
	if (!detailTooltip.value) return;
	pendingDetailTooltipPoint = getTooltipPoint(event);
	if (detailTooltipAnimationFrame != null) return;

	detailTooltipAnimationFrame = window.requestAnimationFrame(() => {
		detailTooltipAnimationFrame = null;
		const point = pendingDetailTooltipPoint;
		pendingDetailTooltipPoint = null;
		if (!point || !detailTooltip.value) return;
		detailTooltip.value = { ...detailTooltip.value, ...point };
	});
}

function showCooldownTooltip(cooldown: TimelineCooldown, event: MouseEvent) {
	cancelDetailTooltipPositionUpdate();
	const point = getTooltipPoint(event);
	detailTooltip.value = { kind: 'cooldown', cooldown, ...point };
}

function showDeathTooltip(death: DeathPeriod, event: MouseEvent) {
	cancelDetailTooltipPositionUpdate();
	const point = getTooltipPoint(event);
	detailTooltip.value = { kind: 'death', death, ...point };
}

function showBossCastTooltip(
	lane: BossCastLane,
	marker: BossCastMarker,
	event: MouseEvent,
	occurrences: BossCastMarker[] = [marker],
) {
	cancelDetailTooltipPositionUpdate();
	const point = getTooltipPoint(event);
	const placement = occurrences.length > 1 && event.clientY < window.innerHeight / 2
		? 'below'
		: 'above';
	detailTooltip.value = { kind: 'boss', lane, marker, occurrences, placement, ...point };
	void prepareBossCastTooltip();
}

function hideDetailTooltip() {
	cancelDetailTooltipPositionUpdate();
	clearBossCastTooltipLayout();
	detailTooltip.value = null;
}

function getTimelinePoint(event: MouseEvent) {
	const timeline = event.currentTarget as HTMLElement;
	const rect = timeline.getBoundingClientRect();
	const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
	return {
		percent,
		timestampSeconds: percent * (props.fightDuration / 1000),
	};
}

function onTimelineClick(event: MouseEvent) {
	emit('seek', getTimelinePoint(event).timestampSeconds);
}

function onTimelineMove(event: MouseEvent, context: HoverContext) {
	pendingTimelineMove = {
		context,
		timeline: event.currentTarget as HTMLElement,
		clientX: event.clientX,
	};
	if (timelineHoverAnimationFrame != null) return;

	timelineHoverAnimationFrame = window.requestAnimationFrame(() => {
		timelineHoverAnimationFrame = null;
		const pendingMove = pendingTimelineMove;
		pendingTimelineMove = null;
		if (!pendingMove) return;

		const timelineRect = pendingMove.timeline.getBoundingClientRect();
		if (timelineRect.width <= 0) return;
		const tooltipAnchorRect = pendingMove.context === 'expanded'
			? expandedTimelineAnchor.value?.getBoundingClientRect()
			: timelineRect;
		const percent = Math.max(0, Math.min(1, (pendingMove.clientX - timelineRect.left) / timelineRect.width));
		const edgePadding = Math.min(100, Math.max(8, window.innerWidth / 2));
		timelineHover.value = {
			visible: true,
			context: pendingMove.context,
			percent,
			timestampSeconds: percent * (props.fightDuration / 1000),
			x: Math.max(edgePadding, Math.min(window.innerWidth - edgePadding, pendingMove.clientX)),
			y: Math.max(
				32,
				pendingMove.context === 'expanded'
					? (tooltipAnchorRect?.bottom ?? timelineRect.top) - 6
					: timelineRect.top - 6,
			),
		};
	});
}

function onTimelineLeave(context: HoverContext) {
	if (pendingTimelineMove?.context === context) {
		pendingTimelineMove = null;
	}
	if (timelineHoverAnimationFrame != null) {
		window.cancelAnimationFrame(timelineHoverAnimationFrame);
		timelineHoverAnimationFrame = null;
	}
	if (timelineHover.value.context === context) {
		timelineHover.value.visible = false;
	}
}

onBeforeUnmount(() => {
	window.removeEventListener('resize', onWindowResize);
	finishExpandedTimelineResize();
	restoreResizeBodyStyles();
	expandedScrollerResizeObserver?.disconnect();
	expandedScrollerResizeObserver = null;
	customScrollbarDrag = null;
	clearCustomScrollbarHideTimer();
	if (customScrollbarAnimationFrame != null) {
		window.cancelAnimationFrame(customScrollbarAnimationFrame);
		customScrollbarAnimationFrame = null;
	}
	if (expandedTimelineResizeAnimationFrame != null) {
		window.cancelAnimationFrame(expandedTimelineResizeAnimationFrame);
		expandedTimelineResizeAnimationFrame = null;
	}
	cancelDetailTooltipPositionUpdate();
	pendingTimelineMove = null;
	if (timelineHoverAnimationFrame != null) {
		window.cancelAnimationFrame(timelineHoverAnimationFrame);
		timelineHoverAnimationFrame = null;
	}
});

function seekToDeath(death: DeathPeriod) {
	emit('seek', Math.max(0, death.timestampSeconds - 10));
}

const deathPeriods = computed<DeathPeriod[]>(() => {
	if (props.fightDuration <= 0) return [];

	const periods: DeathPeriod[] = [];
	const openDeaths = new Map<string, DeathPeriod>();
	const fightDurationSeconds = props.fightDuration / 1000;
	let deathID = 0;

	[...props.fightEvents]
		.sort((left, right) => left.timestamp - right.timestamp)
		.forEach((event) => {
			const eventType = event.type.toLowerCase();

			if (eventType === 'death') {
				deathID++;
				const relativeTime = event.timestamp - props.fightStartTime;
				if (relativeTime < 0 || relativeTime > props.fightDuration || !event.target) return;

				const actorKey = getActorKey(event.target);
				const percent = relativeTime / props.fightDuration;
				const existingDeath = openDeaths.get(actorKey);
				if (existingDeath) {
					existingDeath.endPercent = percent;
					existingDeath.endTimestampSeconds = relativeTime / 1000;
				}

				const death: DeathPeriod = {
					event,
					key: `death:${deathID}:${event.timestamp}:${actorKey}`,
					actorKey,
					id: deathID,
					name: event.target.name || 'Unknown player',
					className: event.target.type || '',
					actorIcon: event.target.icon || '',
					spell: event.killingAbility?.name || 'Unknown ability',
					icon: event.killingAbility?.abilityIcon || '',
					percent,
					endPercent: 1,
					timestampSeconds: relativeTime / 1000,
					endTimestampSeconds: fightDurationSeconds,
					resurrected: false,
				};
				periods.push(death);
				openDeaths.set(actorKey, death);
				return;
			}

			const isPlayerResurrection = eventType === 'resurrect' && Boolean(event.target);
			const isReincarnation = (
				eventType === 'cast'
				&& event.ability?.guid === REINCARNATION_CAST_SPELL_ID
				&& Boolean(event.source)
			);
			if (!isPlayerResurrection && !isReincarnation) return;

			const resurrectedActor = isReincarnation ? event.source : event.target;
			const actorKey = getActorKey(resurrectedActor);
			const death = openDeaths.get(actorKey);
			if (!death) return;

			const relativeTime = Math.max(0, Math.min(props.fightDuration, event.timestamp - props.fightStartTime));
			death.endPercent = Math.max(death.percent, relativeTime / props.fightDuration);
			death.endTimestampSeconds = Math.max(death.timestampSeconds, relativeTime / 1000);
			death.resurrected = true;
			death.resurrectionEvent = event;
			death.resurrectionKind = isReincarnation ? 'reincarnation' : 'player';
			openDeaths.delete(actorKey);
		});

	return periods;
});

const visibleDeathPeriods = computed(() => (
	enabledGroupIDs.value.has('deaths') ? deathPeriods.value : []
));

const lanes = computed<TimelineLane[]>(() => {
	if (props.fightDuration <= 0) return [];

	const shouldFilterGroups = props.groups.length > 0;
	const eventsBySource = new Map<string, {
		actorID?: number;
		name: string;
		className: string;
		actorIcon: string;
		role: PlayerRole;
		events: Array<Omit<TimelineCooldown, 'track'>>;
		deathPeriods: DeathPeriod[];
	}>();

	props.events.forEach((event, index) => {
		if (
			shouldFilterGroups
			&& !event.cooldown.groups.some(groupID => enabledGroupIDs.value.has(groupID))
		) {
			return;
		}
		if (excludedSpellIDSet.value.has(event.cooldown.spellID)) return;

		const relativeTime = event.timestamp - props.fightStartTime;
		if (relativeTime < 0 || relativeTime > props.fightDuration) return;

		const sourceName = event.source?.name || 'Unknown player';
		const sourceKey = getActorKey(event.source);
		const sourceEntry = eventsBySource.get(sourceKey) || {
			actorID: event.source?.id,
			name: sourceName,
			className: event.source?.type || '',
			actorIcon: event.source?.icon || '',
			role: getActorRole(event.source),
			events: [],
			deathPeriods: [],
		};
		if (sourceEntry.role === 'unknown') {
			sourceEntry.role = getActorRole(event.source);
		}
		if (!sourceEntry.actorIcon && event.source?.icon) {
			sourceEntry.actorIcon = event.source.icon;
		}
		if (sourceEntry.actorID == null && event.source?.id != null) {
			sourceEntry.actorID = event.source.id;
		}

		sourceEntry.events.push({
			event,
			key: `${event.timestamp}:${event.cooldown.spellID}:${index}`,
			percent: relativeTime / props.fightDuration,
			timestampSeconds: relativeTime / 1000,
		});
		eventsBySource.set(sourceKey, sourceEntry);
	});

	visibleDeathPeriods.value.forEach((death) => {
		const sourceEntry = eventsBySource.get(death.actorKey) || {
			actorID: death.event.target?.id,
			name: death.name,
			className: death.className,
			actorIcon: death.actorIcon,
			role: getActorRole({
				icon: death.actorIcon,
				type: death.className,
			}),
			events: [],
			deathPeriods: [],
		};
		if (sourceEntry.role === 'unknown') {
			sourceEntry.role = getActorRole({
				icon: death.actorIcon,
				type: death.className,
			});
		}
		if (!sourceEntry.actorIcon && death.actorIcon) {
			sourceEntry.actorIcon = death.actorIcon;
		}
		if (sourceEntry.actorID == null && death.event.target?.id != null) {
			sourceEntry.actorID = death.event.target.id;
		}
		sourceEntry.deathPeriods.push(death);
		eventsBySource.set(death.actorKey, sourceEntry);
	});

	return [...eventsBySource.entries()]
		.map(([key, lane]): TimelineLane => {
			const trackEndPositions: number[] = [];
			const cooldowns = lane.events
				.sort((left, right) => left.percent - right.percent)
				.map((cooldown): TimelineCooldown => {
					let track = trackEndPositions.findIndex(
						lastPercent => cooldown.percent - lastPercent >= MIN_EVENT_GAP_PERCENT,
					);
					if (track === -1) track = trackEndPositions.length;
					trackEndPositions[track] = cooldown.percent;
					return { ...cooldown, track };
				});

			return {
				key,
				actorID: lane.actorID,
				name: lane.name,
				className: lane.className,
				actorIcon: lane.actorIcon,
				role: lane.role,
				height: Math.max(38, TRACK_TOP_OFFSET_PX * 2 + trackEndPositions.length * TRACK_HEIGHT_PX),
				cooldowns,
				deathPeriods: lane.deathPeriods,
			};
		})
		.filter(lane => (
			lane.cooldowns.length > 0
			|| lane.deathPeriods.length > 0
		))
		.sort((left, right) => (
			ROLE_SORT_ORDER[left.role] - ROLE_SORT_ORDER[right.role]
			|| left.className.localeCompare(right.className)
			|| left.name.localeCompare(right.name)
		));
});

const timelineRows = computed<TimelineRow[]>(() => {
	const roleCounts = lanes.value.reduce<Record<PlayerRole, number>>((counts, lane) => {
		counts[lane.role]++;
		return counts;
	}, {
		tank: 0,
		healer: 0,
		dps: 0,
		unknown: 0,
	});
	const rows: TimelineRow[] = [];
	let previousRole: PlayerRole | null = null;

	lanes.value.forEach((lane, stripeIndex) => {
		if (lane.role !== previousRole) {
			rows.push({
				kind: 'role',
				key: `role:${lane.role}`,
				role: lane.role,
				label: ROLE_LABELS[lane.role],
				count: roleCounts[lane.role],
			});
			previousRole = lane.role;
		}
		rows.push({
			kind: 'lane',
			key: `lane:${lane.key}`,
			lane,
			stripeIndex,
		});
	});

	return rows;
});

watch([timelineRows, bossCastLanes, () => reviewsStore.bossCastDisplayMode], () => {
	void nextTick(scheduleCustomScrollbarUpdate);
}, { flush: 'post' });
watch(
	[
		bossCastLanes,
		() => reviewsStore.bossCastDisplayMode,
		isExpanded,
		timelineViewMode,
	],
	() => {
		if (
			!isExpanded.value
			|| timelineViewMode.value !== 'fight'
			|| reviewsStore.bossCastDisplayMode !== 'full'
		) return;
		void nextTick(refreshWowheadTooltips);
	},
	{ flush: 'post', immediate: true },
);

const visibleCooldownCount = computed(() => (
	lanes.value.reduce((total, lane) => total + lane.cooldowns.length, 0)
));

const detailTooltipPosition = computed(() => {
	const tooltip = detailTooltip.value;
	if (!tooltip) return {};
	return {
		left: `${tooltip.x}px`,
		top: `${tooltip.y}px`,
	};
});

const timelineTooltipPosition = computed(() => {
	if (!timelineHover.value.visible) return {};
	return {
		left: `${timelineHover.value.x}px`,
		top: `${timelineHover.value.y}px`,
	};
});

function openPlayerComparison(lane: TimelineLane) {
	comparisonPlayerRequest.value = {
		token: nextComparisonPlayerRequestToken++,
		playerID: lane.actorID,
		playerName: lane.name,
	};
	timelineViewMode.value = 'comparison';
	timelineHover.value.visible = false;
	hideDetailTooltip();
}

function onComparisonPlayerRequestApplied(token: number) {
	if (comparisonPlayerRequest.value?.token === token) {
		comparisonPlayerRequest.value = null;
	}
}
</script>

<template>
	<section class="relative" :class="detached ? 'h-full min-h-0' : 'shrink-0'" style="--review-timeline-sidebar-width: 9rem;">
		<div
			v-if="isExpanded"
			id="review-cooldown-timeline-panel"
			ref="expandedTimelinePanel"
			class="z-[120] flex min-h-40 flex-col overflow-hidden border border-sky-500/25 bg-light2 dark:border-sky-400/20 dark:bg-dark2"
			:class="detached
				? 'relative h-full min-h-0 w-full rounded-none shadow-none'
				: 'absolute bottom-[calc(100%+0.5rem)] left-0 right-0 rounded-lg shadow-2xl'"
			:style="{
				height: detached
					? '100%'
					: isExpandedTimelineResizing
					? 'var(--review-expanded-timeline-drag-height)'
					: `${expandedTimelineHeight}px`,
				maxHeight: detached ? 'none' : `${expandedTimelineMaxHeight}px`,
				contain: 'layout paint',
			}"
		>
			<button
				v-if="!detached"
				type="button"
				class="group absolute inset-x-0 top-0 z-[60] h-2 touch-none cursor-ns-resize focus:outline-none focus-visible:bg-sky-500/10"
				:class="{ 'bg-sky-500/10': isExpandedTimelineResizing }"
				role="separator"
				aria-label="Resize expanded timeline"
				aria-orientation="horizontal"
				aria-controls="review-cooldown-timeline-panel"
				:aria-valuemin="MIN_EXPANDED_HEIGHT_PX"
				:aria-valuemax="expandedTimelineMaxHeight"
				:aria-valuenow="expandedTimelineHeight"
				title="Drag to resize timeline"
				@pointerdown="onExpandedTimelineResizePointerDown"
				@pointermove="onExpandedTimelineResizePointerMove"
				@pointerup="onExpandedTimelineResizePointerEnd"
				@pointercancel="onExpandedTimelineResizePointerEnd"
				@keydown="onExpandedTimelineResizeKeydown"
			>
				<span class="pointer-events-none absolute left-1/2 top-px h-[3px] w-16 -translate-x-1/2 border-x border-sky-400/35 bg-neutral-500/45 transition-colors group-hover:bg-sky-400/70 group-focus-visible:bg-sky-400/70"></span>
			</button>
			<div class="relative z-30 flex h-10 shrink-0 items-center justify-between gap-3 border-b border-neutral-400/30 bg-light4 px-3 text-sm shadow-sm dark:border-neutral-600/30 dark:bg-dark4">
				<div class="flex min-w-0 items-center gap-2">
					<h2 class="shrink-0 font-semibold tracking-tight">Fight timeline</h2>
					<div class="ml-1 flex rounded-sm border border-neutral-500/30 bg-black/5 p-0.5 text-[10px] dark:bg-black/20">
						<button type="button" class="h-5 rounded-sm px-2" :class="timelineViewMode === 'fight' ? 'bg-sky-500/20 text-sky-600 dark:text-sky-300' : 'text-neutral-500 hover:text-inherit'" @click="timelineViewMode = 'fight'">Raid</button>
						<button type="button" class="h-5 rounded-sm px-2" :class="timelineViewMode === 'comparison' ? 'bg-sky-500/20 text-sky-600 dark:text-sky-300' : 'text-neutral-500 hover:text-inherit'" @click="timelineViewMode = 'comparison'">Pull comparison</button>
					</div>
					<button
						v-if="!detached"
						type="button"
						class="flex h-6 shrink-0 items-center gap-1 border border-neutral-500/30 bg-neutral-500/[0.06] px-2 text-[10px] font-medium text-neutral-600 hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:text-neutral-300 dark:hover:text-sky-300"
						title="Open timeline in a separate window"
						@click="emit('detach')"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-3.5" aria-hidden="true"><path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v7.5C3 13.216 3.784 14 4.75 14H7v-1.5H4.75a.25.25 0 0 1-.25-.25v-7.5a.25.25 0 0 1 .25-.25h7.5a.25.25 0 0 1 .25.25V7H14V4.75A1.75 1.75 0 0 0 12.25 3h-7.5Z"/><path d="M9.75 7A1.75 1.75 0 0 0 8 8.75v6.5c0 .966.784 1.75 1.75 1.75h5.5A1.75 1.75 0 0 0 17 15.25v-6.5A1.75 1.75 0 0 0 15.25 7h-5.5Zm-.25 1.75a.25.25 0 0 1 .25-.25h5.5a.25.25 0 0 1 .25.25v6.5a.25.25 0 0 1-.25.25h-5.5a.25.25 0 0 1-.25-.25v-6.5Z"/></svg>
						Detach
					</button>
					<template v-if="timelineViewMode === 'fight'"><span v-if="loading" class="shrink-0 text-xs text-neutral-500">Loading cooldowns...</span><span v-else-if="error" class="shrink-0 text-xs text-red-500">Cooldowns unavailable</span></template>
				</div>
				<div v-if="timelineViewMode === 'fight'" class="flex min-w-0 items-center gap-1.5 text-[10px]">
					<span class="rounded border border-neutral-500/25 bg-light4/70 px-1.5 py-0.5 tabular-nums text-neutral-600 dark:bg-dark4/70 dark:text-neutral-300">
						{{ visibleCooldownCount }} casts
					</span>
					<span class="rounded border border-neutral-500/25 bg-light4/70 px-1.5 py-0.5 tabular-nums text-neutral-600 dark:bg-dark4/70 dark:text-neutral-300">
						{{ visibleDeathPeriods.length }} deaths
					</span>
					<span class="rounded border border-neutral-500/25 bg-light4/70 px-1.5 py-0.5 tabular-nums text-neutral-600 dark:bg-dark4/70 dark:text-neutral-300">
						{{ lanes.length }} players
					</span>
					<button
						type="button"
						class="flex h-6 shrink-0 items-center gap-1 border border-neutral-500/30 bg-neutral-500/[0.06] px-2 font-medium text-neutral-600 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:cursor-wait disabled:opacity-50 dark:text-neutral-300 dark:hover:text-amber-300"
						:class="isBossCastFiltersExpanded ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300' : ''"
						:disabled="isBossCastsLoading"
						:aria-expanded="isBossCastFiltersExpanded"
						@click="isBossCastFiltersExpanded = !isBossCastFiltersExpanded"
					>
						<span v-if="isBossCastsLoading">Boss casts...</span>
						<span v-else>Boss {{ visibleBossCastAbilityCount }}/{{ bossCastAbilities.length }}</span>
						<span v-if="bossCastInterruptsIncomplete" class="font-bold text-amber-500" title="Interrupt details are incomplete" aria-label="Interrupt details are incomplete">!</span>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-3 transition-transform" :class="{ 'rotate-180': isBossCastFiltersExpanded }">
							<path fill-rule="evenodd" d="M5.22 7.47a.75.75 0 0 1 1.06 0L10 11.19l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.53a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
						</svg>
					</button>
					<button
						type="button"
						class="ml-1 flex h-6 shrink-0 items-center gap-1 border border-neutral-500/30 bg-neutral-500/[0.06] px-2 text-[10px] font-medium text-neutral-600 hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:text-neutral-300 dark:hover:text-sky-300"
						title="Open this pull in Warcraft Logs"
						aria-label="Open this pull in Warcraft Logs"
						@click="emit('openFight')"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-3.5" aria-hidden="true">
							<path d="M11.75 3.5a.75.75 0 0 1 .75-.75h4.75v4.75a.75.75 0 0 1-1.5 0V5.31l-6.22 6.22a.75.75 0 0 1-1.06-1.06l6.22-6.22H12.5a.75.75 0 0 1-.75-.75Z" />
							<path d="M5.25 4.75A2.5 2.5 0 0 0 2.75 7.25v7.5a2.5 2.5 0 0 0 2.5 2.5h7.5a2.5 2.5 0 0 0 2.5-2.5V10.5a.75.75 0 0 0-1.5 0v4.25a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1H9.5a.75.75 0 0 0 0-1.5H5.25Z" />
						</svg>
						<span class="hidden xl:inline">Open in WCL</span>
					</button>
				</div>
			</div>

			<div
				v-if="groups.length"
				class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-neutral-400/30 bg-light4 px-3 py-2 shadow-inner dark:border-neutral-600/30 dark:bg-dark4"
			>
				<div class="mr-0.5 flex shrink-0 items-center gap-1.5 border-r border-neutral-500/25 pr-2">
					<span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
						Cooldown groups
					</span>
					<span class="rounded bg-neutral-500/10 px-1 py-0.5 text-[9px] tabular-nums text-neutral-500 dark:text-neutral-400">
						{{ enabledGroups.length }}/{{ groups.length }}
					</span>
				</div>
				<button
					v-for="group in groups"
					:key="group.id"
					type="button"
					class="flex h-6 items-center gap-1.5 rounded border px-2 text-[11px] shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-wait disabled:opacity-60"
					:class="enabledGroupIDs.has(group.id)
						? 'border-sky-500/60 bg-sky-500/10 text-neutral-900 dark:text-white'
						: 'border-neutral-500/25 bg-light4/40 text-neutral-500 hover:border-neutral-500/60 hover:bg-light4/70 dark:bg-dark4/40 dark:text-neutral-400 dark:hover:bg-dark4/70'"
					:aria-pressed="enabledGroupIDs.has(group.id)"
					:disabled="!groupPreferencesLoaded"
					@click="toggleGroup(group.id)"
				>
					<span
						class="size-1.5 rounded-sm"
						:class="getGroupIndicatorColor(group.id)"
					></span>
					{{ group.label }}
				</button>

				<div class="ml-auto flex items-center gap-0.5 rounded border border-neutral-500/25 bg-light4/45 p-0.5 text-[10px] shadow-inner dark:bg-dark4/45">
					<button
						type="button"
						class="flex h-5 items-center gap-1 rounded-sm px-2 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
						:class="isSpellFiltersExpanded
							? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
							: 'text-neutral-500 hover:bg-neutral-500/15 hover:text-inherit dark:text-neutral-400'"
						:disabled="!spellPreferencesLoaded || spellOptions.length === 0"
						:aria-expanded="isSpellFiltersExpanded"
						@click="isSpellFiltersExpanded = !isSpellFiltersExpanded"
					>
						Spells {{ visibleSpellCount }}/{{ spellOptions.length }}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="size-3 transition-transform"
							:class="{ 'rotate-180': isSpellFiltersExpanded }"
						>
							<path
								fill-rule="evenodd"
								d="M5.22 7.47a.75.75 0 0 1 1.06 0L10 11.19l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.53a.75.75 0 0 1 0-1.06Z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
					<span class="mx-0.5 h-3.5 w-px bg-neutral-500/25"></span>
					<button
						type="button"
						class="h-5 rounded-sm px-2 text-neutral-500 hover:bg-neutral-500/15 hover:text-inherit focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50 dark:text-neutral-400"
						:disabled="!groupPreferencesLoaded"
						@click="enableAllGroups"
					>
						All
					</button>
					<button
						type="button"
						class="h-5 rounded-sm px-2 text-neutral-500 hover:bg-neutral-500/15 hover:text-inherit focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50 dark:text-neutral-400"
						:disabled="!groupPreferencesLoaded"
						@click="disableAllGroups"
					>
						None
					</button>
					<button
						type="button"
						class="h-5 rounded-sm px-2 text-neutral-500 hover:bg-neutral-500/15 hover:text-inherit focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50 dark:text-neutral-400"
						:disabled="!groupPreferencesLoaded"
						@click="restoreDefaultGroups"
					>
						Defaults
					</button>
					<button
						v-if="bossCastInterruptsIncomplete"
						type="button"
						class="h-7 shrink-0 border border-amber-500/40 bg-amber-500/10 px-2 text-[10px] text-amber-700 hover:border-amber-500/70 hover:bg-amber-500/15 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:text-amber-300"
						title="Boss casts loaded, but the WCL interrupt request failed"
						@click="retrySelectedBossCasts"
					>
						Interrupts incomplete · Retry
					</button>
				</div>
			</div>

			<div
				v-if="isSpellFiltersExpanded && spellOptions.length > 0"
				class="shrink-0 border-b border-neutral-400/30 bg-light4 px-3 py-2 shadow-inner dark:border-neutral-600/30 dark:bg-dark4"
			>
				<div class="flex items-center gap-2">
					<div class="flex shrink-0 items-center gap-1.5 border-r border-neutral-500/25 pr-2">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
							Fight spells
						</span>
						<span class="rounded bg-neutral-500/10 px-1 py-0.5 text-[9px] tabular-nums text-neutral-500 dark:text-neutral-400">
							{{ visibleSpellCount }}/{{ spellOptions.length }}
						</span>
					</div>
					<input
						v-model="spellSearchQuery"
						type="search"
						placeholder="Search name or ID"
						class="h-7 min-w-32 flex-1 rounded border border-neutral-500/30 bg-light4 px-2 text-[11px] shadow-inner outline-none transition-colors placeholder:text-neutral-500 focus:border-sky-500 dark:bg-dark4"
					/>
					<button
						type="button"
						class="h-7 shrink-0 rounded border border-neutral-500/25 bg-light4/50 px-2 text-[10px] text-neutral-500 shadow-sm hover:bg-neutral-500/15 hover:text-inherit focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50 dark:bg-dark4/50 dark:text-neutral-400"
						:disabled="spellFilterMode === 'all'"
						@click="showAllSpells"
					>
						Show all
					</button>
				</div>

				<div class="mt-1.5 flex flex-wrap items-center gap-1 overflow-x-hidden text-[10px]">
					<button
						type="button"
						class="h-5 shrink-0 rounded border px-2 shadow-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
						:class="activeSpellFilterGroupID === 'all'
							? 'border-sky-500/60 bg-sky-500/10 text-inherit'
							: 'border-neutral-500/25 bg-light4/35 text-neutral-500 dark:bg-dark4/35 dark:text-neutral-400'"
						@click="activeSpellFilterGroupID = 'all'"
					>
						All {{ spellOptions.length }}
					</button>
					<button
						v-for="group in groups.filter(group => (spellCountByGroup.get(group.id) || 0) > 0)"
						:key="`spell-group:${group.id}`"
						type="button"
						class="flex h-5 shrink-0 items-center gap-1 rounded border px-2 shadow-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
						:class="activeSpellFilterGroupID === group.id
							? 'border-sky-500/60 bg-sky-500/10 text-inherit'
							: 'border-neutral-500/25 bg-light4/35 text-neutral-500 dark:bg-dark4/35 dark:text-neutral-400'"
						@click="activeSpellFilterGroupID = group.id"
					>
						<span class="size-1.5 rounded-full" :class="getGroupIndicatorColor(group.id)"></span>
						{{ group.label }} {{ spellCountByGroup.get(group.id) || 0 }}
					</button>
				</div>

				<div
					class="mt-1.5 grid max-h-32 gap-1 overflow-x-hidden overflow-y-auto pr-1"
					style="grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));"
				>
					<template v-for="classGroup in filteredSpellOptionGroups" :key="classGroup.key">
						<div
							class="col-span-full mt-0.5 flex items-center gap-1.5 border-b border-neutral-500/20 px-0.5 pb-0.5 text-[10px] font-semibold first:mt-0"
						>
							<span :class="getClassTextColor(classGroup.className)">{{ classGroup.label }}</span>
							<span class="font-normal text-neutral-500 dark:text-neutral-400">
								{{ classGroup.options.length }}
								{{ classGroup.options.length === 1 ? 'spell' : 'spells' }}
							</span>
						</div>
						<button
							v-for="option in classGroup.options"
							:key="option.spellID"
							type="button"
							class="flex min-w-0 items-center gap-2 rounded-sm border px-1.5 py-1 text-left shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-sky-500"
							:class="excludedSpellIDSet.has(option.spellID)
								? 'border-neutral-500/20 bg-transparent opacity-55 grayscale hover:opacity-80'
								: 'border-neutral-500/35 bg-light4/70 hover:border-sky-500/60 dark:bg-dark4/70'"
							:aria-pressed="!excludedSpellIDSet.has(option.spellID)"
							@click="toggleSpell(option.spellID)"
						>
						<img
							v-if="option.icon"
							:src="getSpellIconURL(option.icon)"
							alt=""
							class="size-6 shrink-0 rounded"
							draggable="false"
						/>
						<span
							v-else
							class="flex size-6 shrink-0 items-center justify-center rounded bg-black text-[10px] text-white"
						>
							{{ option.name.slice(0, 1) }}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[11px] font-medium">{{ option.name }}</span>
							<span class="block truncate text-[9px] text-neutral-500 dark:text-neutral-400">
								{{ option.groups.map(groupID => groupLabels.get(groupID) || groupID).join(', ') }}
								· {{ option.castCount }} {{ option.castCount === 1 ? 'cast' : 'casts' }}
							</span>
						</span>
						<span
							class="flex size-3.5 shrink-0 items-center justify-center rounded-sm border"
							:class="excludedSpellIDSet.has(option.spellID)
								? 'border-neutral-500/50'
								: 'border-sky-500 bg-sky-500 text-white'"
						>
							<svg
								v-if="!excludedSpellIDSet.has(option.spellID)"
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 20 20"
								fill="currentColor"
								class="size-3"
							>
								<path
									fill-rule="evenodd"
									d="M16.704 5.292a1 1 0 0 1 .004 1.414l-7.5 7.543a1 1 0 0 1-1.42 0l-3.5-3.52a1 1 0 1 1 1.42-1.41l2.79 2.806 6.79-6.829a1 1 0 0 1 1.416-.004Z"
									clip-rule="evenodd"
								/>
							</svg>
						</span>
						</button>
					</template>
					<div
						v-if="filteredSpellOptions.length === 0"
						class="col-span-full py-3 text-center text-[11px] text-neutral-500"
					>
						No spells match this filter.
					</div>
				</div>
			</div>

			<div
				v-if="timelineViewMode === 'fight' && isBossCastFiltersExpanded"
				class="shrink-0 border-b border-neutral-400/30 bg-light4 px-3 py-2 shadow-inner dark:border-neutral-600/30 dark:bg-dark4"
			>
				<div class="flex items-center gap-2">
					<div class="flex shrink-0 items-center gap-1.5 border-r border-neutral-500/25 pr-2">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">Boss casts</span>
						<span class="rounded bg-neutral-500/10 px-1 py-0.5 text-[9px] tabular-nums text-neutral-500 dark:text-neutral-400">
							{{ visibleBossCastAbilityCount }}/{{ bossCastAbilities.length }}
						</span>
					</div>
					<input
						v-model="bossCastSearchQuery"
						type="search"
						placeholder="Search boss spell, source, or ID"
						class="h-7 min-w-32 flex-1 rounded border border-neutral-500/30 bg-light4 px-2 text-[11px] shadow-inner outline-none placeholder:text-neutral-500 focus:border-amber-500 dark:bg-dark4"
					/>
					<button
						type="button"
						class="h-7 shrink-0 rounded border border-neutral-500/25 bg-light4/50 px-2 text-[10px] text-neutral-500 shadow-sm hover:bg-neutral-500/15 hover:text-inherit focus:outline-none focus:ring-1 focus:ring-amber-500 dark:bg-dark4/50 dark:text-neutral-400"
						@click="restoreDefaultBossCasts"
					>
						Defaults
					</button>
				</div>
				<div
					v-if="filteredBossCastAbilities.length > 0"
					class="mt-1.5 grid max-h-32 gap-1 overflow-x-hidden overflow-y-auto pr-1"
					style="grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));"
				>
					<button
						v-for="ability in filteredBossCastAbilities"
						:key="`boss-option:${ability.spellID}`"
						type="button"
						class="flex min-w-0 items-center gap-2 rounded-sm border px-1.5 py-1 text-left shadow-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
						:class="isBossCastAbilityVisible(ability)
							? 'border-amber-500/45 bg-amber-500/[0.08]'
							: 'border-neutral-500/20 bg-transparent opacity-55 grayscale hover:opacity-80'"
						:aria-pressed="isBossCastAbilityVisible(ability)"
						@click="toggleBossCastAbility(ability)"
					>
						<img v-if="ability.icon" :src="getSpellIconURL(ability.icon)" alt="" class="size-6 shrink-0 rounded-none border border-neutral-500/40 bg-black" draggable="false" />
						<span v-else class="flex size-6 shrink-0 items-center justify-center bg-black text-[10px] text-white">{{ ability.name.slice(0, 1) }}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[11px] font-medium">{{ ability.name }}</span>
							<span class="block truncate text-[9px] text-neutral-500 dark:text-neutral-400">
								{{ ability.sources.map(source => source.name).join(', ') }} · {{ ability.castCount }} casts
							</span>
						</span>
						<span class="text-[9px] tabular-nums text-neutral-500">#{{ ability.spellID }}</span>
					</button>
				</div>
				<div v-else class="flex items-center justify-center gap-2 py-3 text-center text-[11px] text-neutral-500">
					<span>{{ bossCastError || (isBossCastsLoading ? 'Loading boss casts...' : 'No boss casts match this filter.') }}</span>
					<button v-if="bossCastError" type="button" class="border border-red-500/35 px-2 py-0.5 text-red-500 hover:bg-red-500/10" @click="retrySelectedBossCasts">Retry</button>
				</div>
			</div>

			<template v-if="timelineViewMode === 'fight'">
			<div
				v-if="(loading || isBossCastsLoading) && lanes.length === 0 && bossCastLanes.length === 0"
				class="flex min-h-0 flex-1 items-center justify-center text-sm text-neutral-500"
			>
				Loading timeline...
			</div>
			<div
				v-else-if="lanes.length === 0 && bossCastLanes.length === 0"
				class="flex min-h-0 flex-1 items-center justify-center px-3 text-sm text-neutral-500"
				:class="{ 'text-red-500': error }"
			>
				{{
						error || bossCastError
						|| (groups.length > 0 && enabledGroupIDs.size === 0
							? 'No cooldown groups selected.'
							: enabledGroupIDs.has('deaths')
								? 'No cooldown casts or player deaths found.'
								: 'No cooldown casts found.')
				}}
			</div>
			<div v-else class="flex min-h-0 flex-1 flex-col">
				<div
					ref="expandedTimelineAnchor"
					class="relative z-20 flex h-8 shrink-0 border-b border-neutral-400/30 bg-light4 text-xs text-neutral-600 shadow-sm dark:border-neutral-600/30 dark:bg-dark4 dark:text-neutral-400"
				>
					<div class="flex shrink-0 items-center border-r border-neutral-500/20 px-2 text-[10px] font-semibold uppercase tracking-wider" style="width: var(--review-timeline-sidebar-width);">
						Raid
					</div>
					<div
						class="relative min-w-0 flex-1"
					>
						<span class="absolute left-1 top-1.5 font-medium tabular-nums">{{ formatTime(0) }}</span>
						<span class="absolute left-1/2 top-1.5 -translate-x-1/2 font-medium tabular-nums">
							{{ formatTime(fightDuration / 2000) }}
						</span>
						<span class="absolute right-1 top-1.5 font-medium tabular-nums">{{ formatTime(fightDuration / 1000) }}</span>
						<span
							v-for="phase in visiblePhases"
							:key="`axis:${phase.name}:${phase.percent}`"
							class="pointer-events-none absolute top-0 -translate-x-1/2 rounded-b-md border-x border-b border-sky-300/25 bg-sky-700/90 px-1.5 py-px text-[10px] font-semibold text-white shadow-sm"
							:style="{ left: `${phase.percent * 100}%` }"
						>
							{{ phase.name }}
						</span>
					</div>
				</div>

				<div class="relative min-h-0 min-w-0 flex-1">
					<div
						id="review-cooldown-timeline-scroll-viewport"
						ref="expandedTimelineScroller"
						class="review-timeline-scroll-viewport h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto"
						@scroll="onCustomScrollbarScroll"
					>
					<div class="flex min-h-full min-w-0">
						<div class="relative z-20 shrink-0 border-r border-neutral-400/25 bg-light4 shadow-[3px_0_7px_rgba(0,0,0,0.12)] dark:border-neutral-600/25 dark:bg-dark4" style="width: var(--review-timeline-sidebar-width);">
							<div
								v-if="bossCastLanes.length > 0"
								class="flex items-center justify-between border-y border-amber-700/20 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300"
								:class="reviewsStore.bossCastDisplayMode === 'collapsed' ? 'sticky top-0 z-[45] bg-light4 shadow-md dark:bg-dark4' : 'bg-amber-950/[0.08] dark:bg-amber-950/20'"
								:style="{ height: `${ROLE_HEADER_HEIGHT_PX}px` }"
							>
								<span>Boss casts</span>
								<div class="flex items-center gap-1">
									<span class="font-medium opacity-70">{{ bossCastLanes.length }}</span>
									<span class="flex border border-neutral-500/30 bg-black/10 p-px normal-case tracking-normal dark:bg-black/25">
										<button type="button" class="h-3.5 px-1 text-[8px] leading-none" :class="reviewsStore.bossCastDisplayMode === 'full' ? 'bg-amber-500/25 text-amber-700 dark:text-amber-200' : 'text-neutral-500 hover:text-inherit'" title="Show one row per boss spell" aria-label="Use full boss cast timeline" @click="setBossCastDisplayMode('full')">Full</button>
										<button type="button" class="h-3.5 px-1 text-[8px] leading-none" :class="reviewsStore.bossCastDisplayMode === 'collapsed' ? 'bg-amber-500/25 text-amber-700 dark:text-amber-200' : 'text-neutral-500 hover:text-inherit'" title="Show all boss casts on one row" aria-label="Use collapsed boss cast timeline" @click="setBossCastDisplayMode('collapsed')">1</button>
									</span>
								</div>
							</div>
							<template v-if="bossCastLanes.length > 0 && reviewsStore.bossCastDisplayMode === 'full'">
								<a
									v-for="(lane, laneIndex) in bossCastLanes"
									:key="`boss-label:${lane.ability.spellID}`"
									:href="`https://www.wowhead.com/spell=${lane.ability.spellID}`"
									target="_blank"
									rel="noopener noreferrer"
									:data-wowhead="`spell=${lane.ability.spellID}`"
									class="relative flex min-w-0 cursor-pointer items-center gap-1.5 border-b border-neutral-500/20 py-0 pl-2 pr-1.5 text-left text-sm font-medium leading-none tracking-tight hover:bg-amber-500/10 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-amber-500/60"
									:class="laneIndex % 2 === 1 ? 'bg-neutral-500/10' : 'bg-transparent'"
									:style="{ height: `${BOSS_CAST_LANE_HEIGHT_PX}px` }"
									:aria-label="`${lane.ability.name} · ${lane.ability.sources.map(source => source.name).join(', ')} · Open on Wowhead`"
									@click.stop
								>
									<span class="absolute inset-y-1 left-0 w-1 bg-amber-700/70"></span>
									<img v-if="lane.ability.icon" :src="getSpellIconURL(lane.ability.icon)" alt="" class="size-5 shrink-0 rounded-none border border-neutral-500/50 bg-black object-cover shadow-sm" draggable="false" />
									<span v-else class="flex size-5 shrink-0 items-center justify-center bg-black text-[9px] text-white">{{ lane.ability.name.slice(0, 1) }}</span>
									<span class="min-w-0 flex-1 truncate">{{ lane.ability.name }}</span>
									<span class="shrink-0 text-[9px] tabular-nums text-neutral-500">{{ lane.markers.length }}</span>
								</a>
							</template>
							<template v-for="row in timelineRows" :key="`label:${row.key}`">
								<div
									v-if="row.kind === 'role'"
									class="flex items-center justify-between border-y px-2 text-[10px] font-bold uppercase tracking-wider"
									:class="getRoleHeaderColor(row.role)"
									:style="{ height: `${ROLE_HEADER_HEIGHT_PX}px` }"
								>
									<span>{{ row.label }}</span>
									<span class="font-medium opacity-70">{{ row.count }}</span>
								</div>
								<button
									v-else
									type="button"
									class="relative flex w-full min-w-0 cursor-pointer items-center gap-1 border-b border-neutral-500/20 py-0 pl-2 pr-1.5 text-left text-sm font-medium leading-none tracking-tight hover:bg-sky-500/[0.07] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-sky-500"
									:class="[
										getClassTextColor(row.lane.className),
										row.stripeIndex % 2 === 1 ? 'bg-neutral-500/10' : 'bg-transparent',
									]"
									:style="{ height: `${row.lane.height}px` }"
									:aria-label="`Compare ${row.lane.name} across pulls`"
									:title="`Compare ${row.lane.name} across pulls`"
									@click="openPlayerComparison(row.lane)"
								>
									<span
										class="absolute inset-y-1 left-0 w-1 rounded-r-sm opacity-90"
										:class="getClassAccentColor(row.lane.className)"
									></span>
									<img
										v-if="row.lane.actorIcon"
										:src="getActorSpecIconURL(row.lane.actorIcon)"
										:alt="`${getActorSpecName(row.lane.actorIcon)} specialization`"
										:title="getActorSpecName(row.lane.actorIcon)"
										class="size-4 shrink-0 rounded-none border border-neutral-500/50 bg-black object-cover shadow-sm"
										draggable="false"
									/>
									<span class="min-w-0 truncate" :title="row.lane.name">{{ row.lane.name }}</span>
								</button>
							</template>
						</div>

						<div
							class="relative min-w-0 flex-1 cursor-pointer bg-light4 dark:bg-dark4"
							role="button"
							tabindex="-1"
							@click="onTimelineClick"
							@mousemove="onTimelineMove($event, 'expanded')"
							@mouseleave="onTimelineLeave('expanded')"
							@mousedown.prevent
						>
							<div
								v-for="marker in minuteTimeMarkers"
								:key="`minute-grid:${marker}`"
								class="pointer-events-none absolute inset-y-0 z-[2] w-px bg-neutral-500/25"
								:style="{ left: `${marker * 100}%` }"
							></div>
							<div
								v-for="phase in visiblePhases"
								:key="`phase:${phase.name}:${phase.percent}`"
								class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-sky-400/80"
								:style="{ left: `${phase.percent * 100}%` }"
							></div>
							<div
								v-if="cursorPercent > 0 && cursorPercent < 1"
								class="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-amber-400"
								:style="{ left: `${cursorPercent * 100}%` }"
							></div>
							<div
								v-if="timelineHover.visible && timelineHover.context === 'expanded'"
								class="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-white/60"
								:style="{ left: `${timelineHover.percent * 100}%` }"
							></div>

							<div
								v-if="bossCastLanes.length > 0"
								class="review-boss-cast-lane relative border-y border-amber-700/20"
								:class="reviewsStore.bossCastDisplayMode === 'collapsed' ? 'sticky top-0 z-[45] cursor-pointer bg-light4 shadow-md dark:bg-dark4' : 'bg-amber-950/[0.08] dark:bg-amber-950/20'"
								:style="{ height: `${ROLE_HEADER_HEIGHT_PX}px` }"
							>
								<template v-if="reviewsStore.bossCastDisplayMode === 'collapsed'">
									<div v-for="marker in minuteTimeMarkers" :key="`collapsed-head-minute:${marker}`" class="pointer-events-none absolute inset-y-0 z-[1] w-px bg-neutral-500/25" :style="{ left: `${marker * 100}%` }"></div>
									<div v-for="phase in visiblePhases" :key="`collapsed-head-phase:${phase.name}:${phase.percent}`" class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-sky-400/80" :style="{ left: `${phase.percent * 100}%` }"></div>
									<div v-if="cursorPercent > 0 && cursorPercent < 1" class="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-amber-400" :style="{ left: `${cursorPercent * 100}%` }"></div>
									<span v-for="marker in collapsedBossCastDurationMarkers.filter(entry => entry.durationSeconds > 0)" :key="`collapsed-head-duration:${marker.key}`" class="review-boss-cast-rail review-boss-cast-rail--compact pointer-events-none absolute top-[9px] z-[6] h-[3px] min-w-px" :class="getBossCastDurationClass(marker)" :style="{ left: `${marker.startPercent * 100}%`, width: `${Math.max(0, marker.percent - marker.startPercent) * 100}%` }"></span>
									<button v-for="item in collapsedBossCastMarkers" :key="`collapsed-head:${item.marker.key}`" type="button" class="absolute top-0 z-20 size-5 overflow-visible rounded-none border bg-black shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-none hover:z-30 hover:scale-110 focus:z-30 focus:outline-none focus:ring-1 focus:ring-amber-200" :class="getBossCastMarkerClass(item.occurrences)" :style="{ left: `clamp(0px, calc(${item.marker.percent * 100}% + ${item.offsetPixels}px), calc(100% - 20px))` }" :aria-label="item.occurrences.length > 1 ? `${item.lane.ability.name}, ${item.occurrences.length} outcomes, first at ${formatCooldownTimestamp(item.marker.timestampSeconds)}` : `${item.lane.ability.name} ${item.marker.event.bossCast.interrupt ? 'interrupted' : 'completed'} for ${item.marker.event.source?.name || 'Unknown enemy'} at ${formatCooldownTimestamp(item.marker.timestampSeconds)}`" @click.stop="emit('seek', item.marker.timestampSeconds)" @mouseenter="showBossCastTooltip(item.lane, item.marker, $event, item.occurrences)" @mousemove="updateDetailTooltipPosition" @mouseleave="hideDetailTooltip">
										<img v-if="item.lane.ability.icon" :src="getSpellIconURL(item.lane.ability.icon)" :alt="item.lane.ability.name" class="block size-full" draggable="false" /><span v-else class="flex size-full items-center justify-center text-[9px] text-white">{{ item.lane.ability.name.slice(0, 1) }}</span>
						<span v-if="item.occurrences.length > 1" class="pointer-events-none absolute bottom-0 right-0 z-10 min-w-3 border border-amber-200/80 bg-amber-500 px-0.5 text-center text-[8px] font-bold leading-[11px] text-black shadow">{{ item.occurrences.length }}</span>
									</button>
									<div v-if="timelineHover.visible && timelineHover.context === 'expanded'" class="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-white/60" :style="{ left: `${timelineHover.percent * 100}%` }"></div>
								</template>
							</div>
							<template v-if="bossCastLanes.length > 0 && reviewsStore.bossCastDisplayMode === 'full'">
							<div
								v-for="(lane, laneIndex) in fullBossCastLanes"
								:key="`boss-plot:${lane.ability.spellID}`"
								class="review-boss-cast-lane relative border-b border-neutral-500/20 transition-none hover:bg-amber-500/[0.035]"
								:class="laneIndex % 2 === 1 ? 'bg-neutral-500/10' : 'bg-transparent'"
								:style="{ height: `${BOSS_CAST_LANE_HEIGHT_PX}px` }"
							>
								<span
									v-for="marker in lane.markers.filter(item => item.durationSeconds > 0)"
									:key="`boss-duration:${marker.key}`"
									class="review-boss-cast-rail pointer-events-none absolute top-[14px] z-[6] h-[5px] min-w-px"
									:class="getBossCastDurationClass(marker)"
									:style="{
										left: `${marker.startPercent * 100}%`,
										width: `${Math.max(0, marker.percent - marker.startPercent) * 100}%`,
									}"
								></span>
								<button
									v-for="item in lane.markerGroups"
									:key="item.marker.key"
									type="button"
									class="absolute top-1 z-20 size-6 overflow-visible rounded-none border bg-black shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-none hover:z-30 hover:scale-105 focus:z-30 focus:outline-none focus:ring-1 focus:ring-amber-200"
									:class="getBossCastMarkerClass(item.occurrences)"
									:style="{ left: `clamp(0px, calc(${item.marker.percent * 100}% + ${item.offsetPixels}px), calc(100% - 24px))` }"
									:aria-label="item.occurrences.length > 1 ? `${lane.ability.name}, ${item.occurrences.length} outcomes, first at ${formatCooldownTimestamp(item.marker.timestampSeconds)}` : `${lane.ability.name} ${item.marker.event.bossCast.interrupt ? 'interrupted' : 'completed'} for ${item.marker.event.source?.name || 'Unknown enemy'} at ${formatCooldownTimestamp(item.marker.timestampSeconds)}`"
									@click.stop="emit('seek', item.marker.timestampSeconds)"
									@mouseenter="showBossCastTooltip(lane, item.marker, $event, item.occurrences)"
									@mousemove="updateDetailTooltipPosition"
									@mouseleave="hideDetailTooltip"
								>
									<img v-if="lane.ability.icon" :src="getSpellIconURL(lane.ability.icon)" :alt="lane.ability.name" class="size-full" draggable="false" />
									<span v-else class="flex size-full items-center justify-center text-[10px] text-white">{{ lane.ability.name.slice(0, 1) }}</span>
									<span v-if="item.occurrences.length > 1" class="pointer-events-none absolute bottom-0 right-0 z-10 min-w-3 border border-amber-200/80 bg-amber-500 px-0.5 text-center text-[8px] font-bold leading-[11px] text-black shadow">{{ item.occurrences.length }}</span>
								</button>
							</div>
							</template>

							<template v-for="row in timelineRows" :key="`plot:${row.key}`">
								<div
									v-if="row.kind === 'role'"
									class="border-y"
									:class="getRoleHeaderColor(row.role)"
									:style="{ height: `${ROLE_HEADER_HEIGHT_PX}px` }"
								></div>
								<div
									v-else
									class="relative border-b border-neutral-500/20 transition-none hover:bg-sky-500/[0.03]"
									:class="row.stripeIndex % 2 === 1 ? 'bg-neutral-500/10' : 'bg-transparent'"
									:style="{ height: `${row.lane.height}px` }"
								>
								<button
									v-for="death in row.lane.deathPeriods"
									:key="death.key"
									type="button"
									class="absolute inset-y-0 z-[5] cursor-pointer border-x border-red-400/70 bg-red-800/45 transition-colors hover:z-20 hover:bg-red-700/65 focus:z-20 focus:bg-red-700/65 focus:outline-none"
									:style="{
										left: death.percent >= 1 ? 'calc(100% - 3px)' : `${death.percent * 100}%`,
										width: `${Math.max(0, death.endPercent - death.percent) * 100}%`,
										minWidth: '3px',
										backgroundImage: 'repeating-linear-gradient(135deg, rgba(248, 113, 113, 0.22) 0, rgba(248, 113, 113, 0.22) 4px, transparent 4px, transparent 8px)',
									}"
									:aria-label="`${death.name} was dead from ${formatEventTime(death.timestampSeconds)} to ${formatEventTime(death.endTimestampSeconds)}`"
									@click.stop="seekToDeath(death)"
									@contextmenu.prevent.stop="emit('openDeath', death.id)"
									@mouseenter="showDeathTooltip(death, $event)"
									@mousemove="updateDetailTooltipPosition"
									@mouseleave="hideDetailTooltip"
								></button>

								<button
									v-for="cooldown in row.lane.cooldowns"
									:key="cooldown.key"
									type="button"
									class="absolute z-20 size-6 overflow-hidden rounded-none border bg-black shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-[transform,box-shadow] hover:z-30 hover:scale-110 hover:shadow-lg focus:z-30 focus:scale-110 focus:outline-none focus:ring-2 focus:ring-white/70"
									:class="getCooldownBorderColor(cooldown.event)"
									:style="{
										left: `clamp(0px, ${cooldown.percent * 100}%, calc(100% - 24px))`,
										top: `${TRACK_TOP_OFFSET_PX + cooldown.track * TRACK_HEIGHT_PX}px`,
									}"
									:aria-label="`${cooldown.event.source?.name || 'Unknown player'} used ${cooldown.event.ability?.name || `Spell ${cooldown.event.cooldown.spellID}`} at ${formatCooldownTimestamp(cooldown.timestampSeconds)}${cooldown.event.cooldown.interruptSuccessful == null ? '' : cooldown.event.cooldown.interruptSuccessful ? ', interrupt successful' : ', no interrupt recorded'}`"
									@click.stop="emit('seek', cooldown.timestampSeconds)"
									@mouseenter="showCooldownTooltip(cooldown, $event)"
									@mousemove="updateDetailTooltipPosition"
									@mouseleave="hideDetailTooltip"
								>
									<img
										v-if="cooldown.event.ability?.abilityIcon"
										:src="getSpellIconURL(cooldown.event.ability.abilityIcon)"
										:alt="cooldown.event.ability?.name || `Spell ${cooldown.event.cooldown.spellID}`"
										class="size-full"
										draggable="false"
									/>
									<span v-else class="flex size-full items-center justify-center text-[10px] text-white">
										{{ cooldown.event.ability?.name?.slice(0, 1) || '?' }}
									</span>
									<span
										v-if="cooldown.event.cooldown.interruptSuccessful != null"
										class="pointer-events-none absolute bottom-0 right-0 flex size-3 items-center justify-center border-l border-t border-black/70 text-[9px] font-black leading-none text-white"
										:class="cooldown.event.cooldown.interruptSuccessful ? 'bg-emerald-600' : 'bg-red-700'"
									>
										{{ cooldown.event.cooldown.interruptSuccessful ? '✓' : '×' }}
									</span>
								</button>
								</div>
							</template>
						</div>
					</div>
				</div>
					<div
						ref="customScrollbarTrack"
						class="absolute inset-y-0 right-0 z-50 w-2.5 border-l border-neutral-400/20 bg-slate-950/25 shadow-inner transition-opacity duration-300 ease-out dark:border-neutral-500/25"
						:class="!customScrollbarState.visible
							? 'pointer-events-none opacity-0'
							: isCustomScrollbarActive
								? 'pointer-events-auto opacity-100'
								: 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100'"
						:aria-hidden="!customScrollbarState.visible"
						@pointerdown="onCustomScrollbarTrackPointerDown"
					>
						<button
							v-show="customScrollbarState.visible"
							type="button"
							class="absolute inset-x-0 touch-none cursor-grab border-y border-neutral-200/25 bg-neutral-400/65 shadow-sm hover:bg-neutral-300/75 active:cursor-grabbing active:bg-sky-400/65 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-sky-300"
							:style="{
								top: `${customScrollbarState.thumbTop}px`,
								height: `${customScrollbarState.thumbHeight}px`,
							}"
							role="scrollbar"
							aria-label="Scroll player timeline"
							aria-controls="review-cooldown-timeline-scroll-viewport"
							aria-orientation="vertical"
							:aria-valuemin="0"
							:aria-valuemax="Math.round(customScrollbarState.maxScroll)"
							:aria-valuenow="Math.round(customScrollbarState.scrollTop)"
							@pointerdown.stop="onCustomScrollbarThumbPointerDown"
							@pointermove="onCustomScrollbarThumbPointerMove"
							@pointerup="onCustomScrollbarThumbPointerEnd"
							@pointercancel="onCustomScrollbarThumbPointerEnd"
							@keydown="onCustomScrollbarKeydown"
						>
							<span class="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-100/35"></span>
						</button>
					</div>
				</div>
			</div>
			</template>
			<ReviewCooldownComparison
				v-else
				:groups="groups"
				:enabled-group-ids="selectedGroupIDs"
				:excluded-spell-ids="excludedSpellIDs"
				:container-resizing="isExpandedTimelineResizing"
				:current-fight-cursor-seconds="cursorPercent * fightDuration / 1000"
				:requested-player-id="comparisonPlayerRequest?.playerID"
				:requested-player-name="comparisonPlayerRequest?.playerName"
				:player-request-token="comparisonPlayerRequest?.token"
				@spell-events-change="comparisonSpellEvents = $event"
				@player-request-applied="onComparisonPlayerRequestApplied"
				@seek-pull="(fightID, timestampSeconds) => emit('seekPull', fightID, timestampSeconds)"
				@open-pull="fightID => emit('openFight', fightID)"
				@open-death="(fightID, deathID) => emit('openPullDeath', fightID, deathID)"
			/>
		</div>

		<div v-if="!detached" class="relative flex h-8 w-full overflow-visible rounded-md border border-neutral-500/30 bg-light4 dark:bg-dark4">
			<button
				type="button"
				class="flex shrink-0 items-center gap-2 rounded-l-md border-r border-neutral-500/30 px-2 text-left transition-colors hover:bg-light3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500 dark:hover:bg-dark3"
				style="width: var(--review-timeline-sidebar-width);"
				:aria-expanded="isExpanded"
				aria-controls="review-cooldown-timeline-panel"
				@click="isExpanded = !isExpanded"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="size-4 shrink-0 transition-transform"
					:class="{ 'rotate-180': isExpanded }"
				>
					<path
						fill-rule="evenodd"
						d="M5.22 12.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L10 8.81l-3.72 3.72a.75.75 0 0 1-1.06 0Z"
						clip-rule="evenodd"
					/>
				</svg>
				<span class="min-w-0 leading-tight">
					<span class="block truncate text-xs font-semibold">Fight timeline</span>
					<span class="block truncate text-[10px] text-neutral-500 dark:text-neutral-400">
						{{ loading ? 'Loading...' : `${visibleCooldownCount} casts / ${visibleDeathPeriods.length} deaths` }}
					</span>
				</span>
			</button>

			<div
				class="relative min-w-0 flex-1 cursor-pointer transition-colors hover:bg-light3 dark:hover:bg-dark3"
				role="button"
				tabindex="-1"
				aria-label="Seek within fight"
				@click="onTimelineClick"
				@mousemove="onTimelineMove($event, 'compact')"
				@mouseleave="onTimelineLeave('compact')"
				@mousedown.prevent
			>
				<div
					v-for="phase in visiblePhases"
					:key="`compact-phase:${phase.name}:${phase.percent}`"
					class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-sky-400"
					:style="{ left: `${phase.percent * 100}%` }"
				>
					<span class="absolute left-1 top-0 text-xs font-semibold leading-none text-sky-500">{{ phase.name }}</span>
				</div>

				<template v-for="death in visibleDeathPeriods" :key="`compact:${death.key}`">
					<div
						class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-red-600"
						:style="{ left: `${death.percent * 100}%` }"
					></div>
					<button
						type="button"
						class="absolute top-0 z-30 -translate-x-1/2 cursor-pointer text-sm leading-none text-red-500 transition-transform hover:scale-125 focus:scale-125 focus:outline-none"
						:style="{ left: `${death.percent * 100}%` }"
						:aria-label="`${death.name} died at ${formatEventTime(death.timestampSeconds)}`"
						@click.stop="seekToDeath(death)"
						@contextmenu.prevent.stop="emit('openDeath', death.id)"
						@mouseenter="showDeathTooltip(death, $event)"
						@mousemove.stop="updateDetailTooltipPosition"
						@mouseleave="hideDetailTooltip"
					>
						<span aria-hidden="true">&#x1F480;</span>
					</button>
				</template>

				<div
					v-if="cursorPercent > 0 && cursorPercent < 1"
					class="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-amber-400"
					:style="{ left: `${cursorPercent * 100}%` }"
				></div>
				<div
					v-if="timelineHover.visible && timelineHover.context === 'compact'"
					class="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-white/60"
					:style="{ left: `${timelineHover.percent * 100}%` }"
				></div>

				<span
					v-if="error"
					class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] text-red-500"
				>
					Cooldowns unavailable
				</span>
			</div>

			<div
				class="pointer-events-none absolute right-0 top-full z-50 mt-0.5 rounded bg-light4 px-1 py-0.5 text-xs font-medium leading-none tabular-nums text-neutral-600 shadow-sm dark:bg-dark4 dark:text-neutral-300"
				aria-label="Fight duration"
			>
				{{ formatTime(fightDuration / 1000) }}
			</div>
		</div>

		<Teleport to="body">
			<div
				v-if="detailTooltip?.kind === 'cooldown'"
				class="pointer-events-none fixed z-[999] w-max max-w-80 -translate-x-1/2 -translate-y-full rounded-md border border-neutral-500/60 bg-black/90 px-3 py-2 text-xs text-white shadow-xl"
				:style="detailTooltipPosition"
			>
				<div class="flex items-center gap-2">
					<img
						v-if="detailTooltip.cooldown.event.ability?.abilityIcon"
						:src="getSpellIconURL(detailTooltip.cooldown.event.ability.abilityIcon)"
						alt=""
						class="size-8 shrink-0 rounded"
					/>
					<div class="min-w-0">
						<div class="font-semibold">
							{{ detailTooltip.cooldown.event.ability?.name || `Spell ${detailTooltip.cooldown.event.cooldown.spellID}` }}
						</div>
						<div>
							<span :class="getClassTextColor(detailTooltip.cooldown.event.source?.type)">
								{{ detailTooltip.cooldown.event.source?.name || 'Unknown player' }}
							</span>
							<span v-if="detailTooltip.cooldown.event.sourcePet?.name" class="text-neutral-400">
								via {{ detailTooltip.cooldown.event.sourcePet.name }}
							</span>
							at {{ formatCooldownTimestamp(detailTooltip.cooldown.timestampSeconds) }}
						</div>
					</div>
				</div>
				<ReviewCooldownTarget
					v-if="detailTooltip.cooldown.event.target"
					:target="detailTooltip.cooldown.event.target"
					:target-marker="detailTooltip.cooldown.event.targetMarker"
					:target-instance="detailTooltip.cooldown.event.targetInstance"
				/>
				<div
					v-if="detailTooltip.cooldown.event.cooldown.interruptSuccessful != null"
					class="mt-1 text-[11px] font-medium"
					:class="detailTooltip.cooldown.event.cooldown.interruptSuccessful ? 'text-emerald-300' : 'text-red-300'"
				>
					<template v-if="detailTooltip.cooldown.event.cooldown.interruptSuccessful">
						Interrupted {{ detailTooltip.cooldown.event.extraAbility?.name || 'a spell' }}
					</template>
					<template v-else>No interrupt recorded</template>
				</div>
				<div class="mt-1 text-[11px] text-neutral-300">
					{{ detailTooltip.cooldown.event.cooldown.groups.map(groupID => groupLabels.get(groupID) || groupID).join(', ') }}
				</div>
			</div>

			<div
				v-else-if="detailTooltip?.kind === 'boss'"
				ref="bossCastTooltipElement"
				class="pointer-events-none fixed z-[999] w-max max-w-[calc(100vw-1rem)] rounded-md border bg-black/90 px-3 py-2 text-xs text-white shadow-xl"
				:class="[
					getBossCastInterruptCount(detailTooltip.occurrences) > 0 ? 'border-emerald-500/60' : 'border-amber-500/55',
				]"
				:style="bossCastTooltipStyle"
			>
				<div class="flex items-center gap-2">
					<img
						v-if="detailTooltip.lane.ability.icon"
						:src="getSpellIconURL(detailTooltip.lane.ability.icon)"
						alt=""
						class="size-8 shrink-0 rounded-none border border-amber-500/50 bg-black"
					/>
					<div class="min-w-0">
						<div class="flex items-center gap-1.5 font-semibold text-amber-200">
							<span>{{ detailTooltip.lane.ability.name }}</span>
							<span v-if="detailTooltip.occurrences.length > 1" class="border border-amber-400/45 bg-amber-500/15 px-1 text-[10px] leading-4 text-amber-100">×{{ detailTooltip.occurrences.length }}</span>
							<span v-else-if="detailTooltip.marker.event.bossCast.interrupt" class="border border-emerald-400/45 bg-emerald-500/15 px-1 text-[10px] leading-4 text-emerald-200">Interrupted</span>
						</div>
						<div v-if="detailTooltip.occurrences.length > 1" class="text-neutral-300">
							{{ detailTooltip.occurrences.length }} casts
							<template v-if="getBossCastOccurrenceSpan(detailTooltip.occurrences) > 0">over {{ formatDuration(getBossCastOccurrenceSpan(detailTooltip.occurrences)) }}</template>
							<template v-else>at the same time</template>
							<span v-if="getBossCastInterruptCount(detailTooltip.occurrences) > 0" class="text-emerald-300"> · {{ getBossCastInterruptCount(detailTooltip.occurrences) }} interrupted</span>
						</div>
						<div v-else class="flex flex-wrap items-center gap-x-1">
							<ReviewRaidMarker :marker="detailTooltip.marker.event.sourceMarker" />
							<span>{{ detailTooltip.marker.event.source?.name || 'Unknown enemy' }}</span>
							<span v-if="detailTooltip.marker.event.sourceInstance != null && detailTooltip.marker.event.sourceInstance > 0" class="text-neutral-400">
								· Spawn #{{ detailTooltip.marker.event.sourceInstance }}
							</span>
							{{ detailTooltip.marker.event.bossCast.interrupt ? 'interrupted' : 'finished' }} at {{ formatCooldownTimestamp(detailTooltip.marker.timestampSeconds) }}
						</div>
					</div>
				</div>
				<template v-if="detailTooltip.occurrences.length > 1">
					<div class="mt-2 grid gap-x-3 border-t border-neutral-500/35 pt-1" :style="bossCastOccurrenceListStyle">
						<div v-for="(occurrence, occurrenceIndex) in detailTooltip.occurrences" :key="`tooltip:${occurrence.key}`" class="min-w-0 border-b border-neutral-700/60 py-1 last:border-b-0 last:pb-0" :style="getBossCastOccurrenceStyle(occurrenceIndex, detailTooltip.occurrences.length)">
							<div class="flex flex-wrap items-center gap-x-1.5">
								<span class="font-semibold tabular-nums text-neutral-400">#{{ occurrenceIndex + 1 }}</span>
								<span class="font-medium tabular-nums text-amber-200">{{ formatCooldownTimestamp(occurrence.timestampSeconds) }}</span>
								<ReviewRaidMarker :marker="occurrence.event.sourceMarker" />
								<span>{{ occurrence.event.source?.name || 'Unknown enemy' }}</span>
								<span v-if="occurrence.event.sourceInstance != null && occurrence.event.sourceInstance > 0" class="text-neutral-400">· Spawn #{{ occurrence.event.sourceInstance }}</span>
								<span v-if="occurrence.durationSeconds > 0" class="text-[11px]" :class="occurrence.event.bossCast.interrupt ? 'text-emerald-300' : 'text-neutral-400'">· Cast time {{ formatDuration(occurrence.durationSeconds) }}</span>
							</div>
							<ReviewCooldownTarget v-if="occurrence.event.target" :target="occurrence.event.target" :target-marker="occurrence.event.targetMarker" :target-instance="occurrence.event.targetInstance" />
							<ReviewBossCastInterrupt v-if="occurrence.event.bossCast.interrupt" :interrupt="occurrence.event.bossCast.interrupt" />
							<div v-else class="mt-1 flex items-center gap-1 text-[11px]">
								<svg viewBox="0 0 16 16" fill="none" class="size-4 shrink-0 border border-amber-500/55 bg-amber-500/10 p-0.5 text-amber-200" aria-hidden="true">
									<path d="m3 8.25 3 3L13 4.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" />
								</svg>
								<span class="font-medium text-amber-200">Cast finished</span>
							</div>
						</div>
					</div>
				</template>
				<template v-else>
					<ReviewCooldownTarget v-if="detailTooltip.marker.event.target" :target="detailTooltip.marker.event.target" :target-marker="detailTooltip.marker.event.targetMarker" :target-instance="detailTooltip.marker.event.targetInstance" />
					<div v-if="detailTooltip.marker.durationSeconds > 0" class="mt-1 text-[11px]" :class="detailTooltip.marker.event.bossCast.interrupt ? 'text-emerald-300' : 'text-neutral-300'">Cast time {{ formatDuration(detailTooltip.marker.durationSeconds) }}</div>
					<ReviewBossCastInterrupt v-if="detailTooltip.marker.event.bossCast.interrupt" :interrupt="detailTooltip.marker.event.bossCast.interrupt" />
				</template>
				<div class="mt-1 text-[10px] text-neutral-400">Spell #{{ detailTooltip.lane.ability.spellID }} · Click to seek<span v-if="detailTooltip.occurrences.length > 1"> to first outcome</span></div>
			</div>

			<div
				v-else-if="detailTooltip?.kind === 'death'"
				class="pointer-events-none fixed z-[999] w-max max-w-80 -translate-x-1/2 -translate-y-full rounded-md border border-red-500/60 bg-black/90 px-3 py-2 text-xs text-white shadow-xl"
				:style="detailTooltipPosition"
			>
				<div class="font-semibold">
					{{ formatEventTime(detailTooltip.death.timestampSeconds) }}
					<span :class="getClassTextColor(detailTooltip.death.className)">{{ detailTooltip.death.name }}</span>
					died
				</div>
				<div class="mt-1 flex items-center gap-2">
					<img
						v-if="detailTooltip.death.icon"
						:src="getSpellIconURL(detailTooltip.death.icon)"
						alt=""
						class="size-7 shrink-0 rounded"
					/>
					<span>to {{ detailTooltip.death.spell }}</span>
				</div>
				<div class="mt-1 text-[11px] text-neutral-300">
					<template v-if="detailTooltip.death.resurrectionKind === 'reincarnation'">
						<div class="flex items-center gap-1.5">
							<img
								v-if="detailTooltip.death.resurrectionEvent?.ability?.abilityIcon"
								:src="getSpellIconURL(detailTooltip.death.resurrectionEvent.ability.abilityIcon)"
								alt=""
								class="size-5 shrink-0 rounded"
							/>
							<span>
								Used {{ detailTooltip.death.resurrectionEvent?.ability?.name || 'Reincarnation' }}
								at {{ formatEventTime(detailTooltip.death.endTimestampSeconds) }}
							</span>
						</div>
						<div class="mt-0.5">
							Self-resurrected after {{ formatDuration(detailTooltip.death.endTimestampSeconds - detailTooltip.death.timestampSeconds) }}
						</div>
					</template>
					<template v-else-if="detailTooltip.death.resurrected">
						<div class="flex items-center gap-1.5">
							<img
								v-if="detailTooltip.death.resurrectionEvent?.ability?.abilityIcon"
								:src="getSpellIconURL(detailTooltip.death.resurrectionEvent.ability.abilityIcon)"
								alt=""
								class="size-5 shrink-0 rounded"
							/>
							<span>
								Resurrected by
								<span :class="getClassTextColor(detailTooltip.death.resurrectionEvent?.source?.type)">
									{{ detailTooltip.death.resurrectionEvent?.source?.name || 'Unknown player' }}
								</span>
								with {{ detailTooltip.death.resurrectionEvent?.ability?.name || 'an unknown spell' }}
							</span>
						</div>
						<div class="mt-0.5">
							At {{ formatEventTime(detailTooltip.death.endTimestampSeconds) }},
							after {{ formatDuration(detailTooltip.death.endTimestampSeconds - detailTooltip.death.timestampSeconds) }}
						</div>
					</template>
					<template v-else>
						Dead for the remaining {{ formatDuration(detailTooltip.death.endTimestampSeconds - detailTooltip.death.timestampSeconds) }}
					</template>
				</div>
				<div class="mt-1 text-[10px] text-neutral-400">Click: seek 10s before · Right-click: open WCL death</div>
			</div>

			<div
				v-if="timelineHover.visible"
				class="pointer-events-none fixed z-[998] -translate-x-1/2 -translate-y-full rounded bg-black/85 px-2 py-1 text-xs text-white shadow"
				:style="timelineTooltipPosition"
			>
				{{ formatCooldownTimestamp(timelineHover.timestampSeconds) }}
			</div>
		</Teleport>
	</section>
</template>

<style scoped>
.review-timeline-scroll-viewport {
	scrollbar-width: none;
}

.review-timeline-scroll-viewport::-webkit-scrollbar {
	display: none;
	width: 0;
	height: 0;
}
</style>
