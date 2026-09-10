<script setup lang="ts">
import log from 'electron-log/renderer';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { IPC_EVENTS } from '@/events';
import ReviewReplayActor from '@/renderer/components/ReviewReplayActor.vue';
import ReviewReplayMapBackground from '@/renderer/components/ReviewReplayMapBackground.vue';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { useReviewTimelinePlayback } from '@/renderer/composables/useReviewTimelinePlayback';
import { useReplayViewport } from '@/renderer/composables/useReplayViewport';
import { getReplayExtensionRenderer } from '@/renderer/replay/replayExtensions';
import { resolveReplayMapDefinition } from '@/replayMaps';
import {
	activeReplayCast,
	isReplayActorActive,
	REVIEW_REPLAY_VERSION,
	replayActorIconURLs,
	sampleReplayPosition,
	type FightReplayData,
	type ReplayActor,
	type ReplayActorKind,
	type ReplayCast,
	type SampledReplayPosition,
} from '@/replay';
import type { WclRequestResult } from '@/wclRequests';

const props = defineProps<{
	reportCode: string;
	fightID: number;
}>();

const emit = defineEmits<{
	seek: [seconds: number];
	togglePlayback: [];
}>();

const replay = shallowRef<FightReplayData | null>(null);
const playback = useReviewTimelinePlayback();
const loading = ref(false);
const error = ref('');
const previewTimestamp = ref<number | null>(null);
const scrubbing = ref(false);
const selectedActorKey = ref<string | null>(null);
const showNames = ref(true);
const showMap = ref(true);
const visibleKinds = ref<Set<ReplayActorKind>>(new Set(['player', 'boss', 'add', 'mechanic']));
const replayCanvas = ref<SVGSVGElement | null>(null);
let requestRevision = 0;

const actorKindOptions = computed<ReadonlyArray<{ kind: ReplayActorKind; label: string }>>(() => [
	{ kind: 'player', label: 'Players' },
	{ kind: 'boss', label: 'Bosses' },
	{ kind: 'add', label: 'Adds' },
	...(replay.value?.actors.some(actor => actor.kind === 'mechanic')
		? [{ kind: 'mechanic' as const, label: 'Mechanics' }]
		: []),
]);
const replayActorDrawOrder: Readonly<Record<ReplayActorKind, number>> = {
	mechanic: 0,
	boss: 1,
	add: 2,
	player: 3,
};
const OBSERVED_POSITION_RETENTION_MS = 3000;

const timestamp = computed(() => (
	previewTimestamp.value
	?? Math.max(0, Math.min(1, playback.cursorPercent.value)) * (replay.value?.duration || 0)
));
const playing = computed(() => playback.playing.value);

watch(() => playback.cursorPercent.value, () => {
	if (!scrubbing.value) previewTimestamp.value = null;
});

async function loadReplay(): Promise<void> {
	const revision = ++requestRevision;
	loading.value = true;
	error.value = '';

	try {
		const response = await ipc.invoke(IPC_EVENTS.WCL_REQUEST_FIGHT_REPLAY, {
			reportCode: props.reportCode,
			fightID: props.fightID,
		}) as WclRequestResult<FightReplayData>;

		if (revision !== requestRevision) return;
		if (
			!response
			|| response.success !== true
			|| response.data.version !== REVIEW_REPLAY_VERSION
			|| !Array.isArray(response.data.actors)
			|| !Array.isArray(response.data.casts)
			|| !Array.isArray(response.data.uiMapIDs)
			|| !Array.isArray(response.data.overlays)
		) {
			throw new Error(
				response && response.success === false
					? response.error
					: 'Replay data is unavailable',
			);
		}

		replay.value = response.data;
	} catch (cause) {
		if (revision === requestRevision) {
			error.value = cause instanceof Error ? cause.message : 'Failed to load replay';
			log.error('Failed to load fight replay', {
				reportCode: props.reportCode,
				fightID: props.fightID,
				error: String(cause),
			});
		}
	} finally {
		if (revision === requestRevision) loading.value = false;
	}
}

onMounted(() => {
	void loadReplay();
});

onBeforeUnmount(() => {
	++requestRevision;
});

watch(() => [props.reportCode, props.fightID] as const, () => {
	replay.value = null;
	selectedActorKey.value = null;
	previewTimestamp.value = null;
	void loadReplay();
});

useIpcOn(IPC_EVENTS.SOCKET_WCL_READY_CALLBACK, () => {
	replay.value = null;
	void loadReplay();
});

const castsByActor = computed(() => {
	const result = new Map<string, ReplayCast[]>();
	for (const cast of replay.value?.casts || []) {
		const casts = result.get(cast.actorKey) || [];
		casts.push(cast);
		result.set(cast.actorKey, casts);
	}
	return result;
});

// Old server responses and some reports expose only a generic actor icon value
// ("Boss"/"NPC"). Use the first observed cast icon as the same deterministic
// fallback as the server, so cached replay payloads render correctly too.
const displayActorsByKey = computed(() => new Map((replay.value?.actors || []).map(actor => {
	if (actor.kind === 'player' || replayActorIconURLs(actor).length > 0) {
		return [actor.key, actor] as const;
	}

	const castIcon = castsByActor.value.get(actor.key)?.find(cast => cast.icon)?.icon;
	return [
		actor.key,
		castIcon ? { ...actor, icon: castIcon } : actor,
	] as const;
})));

function maxPositionAge(actor: ReplayActor): number {
	if (actor.positionRetentionMs === null) return Number.POSITIVE_INFINITY;
	if (Number.isFinite(actor.positionRetentionMs)) {
		return Math.max(0, actor.positionRetentionMs!);
	}
	if (actor.kind === 'player' || actor.kind === 'add') return OBSERVED_POSITION_RETENTION_MS;
	return Number.POSITIVE_INFINITY;
}

const sampledActors = computed(() => (replay.value?.actors || []).flatMap(actor => {
	if (!visibleKinds.value.has(actor.kind) || !isReplayActorActive(actor, timestamp.value)) return [];

	const position = sampleReplayPosition(actor.positions, timestamp.value, maxPositionAge(actor));
	if (!position) return [];

	return [{
		actor: displayActorsByKey.value.get(actor.key) || actor,
		position,
		cast: activeReplayCast(castsByActor.value.get(actor.key) || [], actor.key, timestamp.value),
	}];
}));

const primaryMapID = computed(() => {
	const counts = new Map<number, number>();
	for (const entry of sampledActors.value) {
		const weight = entry.actor.kind === 'player' ? 2 : 1;
		counts.set(entry.position.mapID, (counts.get(entry.position.mapID) || 0) + weight);
	}

	if (counts.size === 0) {
		for (const actor of replay.value?.actors || []) {
			if (!visibleKinds.value.has(actor.kind)) continue;
			for (const position of actor.positions) {
				counts.set(position.mapID, (counts.get(position.mapID) || 0) + 1);
			}
		}
	}

	return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0];
});
const mapDefinition = computed(() => resolveReplayMapDefinition(
	primaryMapID.value,
	replay.value?.uiMapIDs || [],
));
const visibleActors = computed(() => (
	sampledActors.value
		.filter(entry => entry.position.mapID === primaryMapID.value)
		.sort((left, right) => replayActorDrawOrder[left.actor.kind] - replayActorDrawOrder[right.actor.kind])
));
const visibleActorPositions = computed<ReadonlyMap<string, SampledReplayPosition>>(() => (
	new Map(visibleActors.value.map(entry => [entry.actor.key, entry.position]))
));
const extensionRenderer = computed(() => (
	replay.value ? getReplayExtensionRenderer(replay.value.encounterID) : undefined
));

const allPoints = computed(() => (replay.value?.actors || []).flatMap(actor => (
	visibleKinds.value.has(actor.kind)
		? actor.positions
			.filter(position => position.mapID === primaryMapID.value)
			.map(({ x, y }) => ({ x, y }))
		: []
)));

const focusPoints = computed(() => {
	const selected = visibleActors.value.find(entry => entry.actor.key === selectedActorKey.value);
	return selected
		? [{ x: selected.position.x, y: selected.position.y }]
		: visibleActors.value.map(entry => ({ x: entry.position.x, y: entry.position.y }));
});

const viewport = useReplayViewport(allPoints, focusPoints, replayCanvas);
const mapViewport = computed(() => ({
	x: viewport.view.value.x - viewport.viewWidth.value / 2,
	y: viewport.view.value.y - viewport.view.value.height / 2,
	width: viewport.viewWidth.value,
	height: viewport.view.value.height,
}));
const unit = computed(() => viewport.pixelsToWorld.value);
const gridSpacing = computed(() => (
	viewport.view.value.height <= 50
		? 5
		: viewport.view.value.height <= 100 ? 10 : 20
));

const verticalGrid = computed(() => {
	const view = viewport.view.value;
	const start = Math.floor((view.x - viewport.viewWidth.value / 2) / gridSpacing.value) * gridSpacing.value;
	return Array.from(
		{ length: Math.ceil(viewport.viewWidth.value / gridSpacing.value) + 2 },
		(_, index) => start + index * gridSpacing.value,
	);
});

const horizontalGrid = computed(() => {
	const view = viewport.view.value;
	const start = Math.floor((view.y - view.height / 2) / gridSpacing.value) * gridSpacing.value;
	return Array.from(
		{ length: Math.ceil(view.height / gridSpacing.value) + 2 },
		(_, index) => start + index * gridSpacing.value,
	);
});

function compareActors(left: ReplayActor, right: ReplayActor): number {
	return left.name.localeCompare(right.name) || (left.instance || 0) - (right.instance || 0);
}

function actorOptionLabel(actor: ReplayActor): string {
	return actor.instance ? `${actor.name} #${actor.instance}` : actor.name;
}

const actorGroups = computed(() => ({
	players: (replay.value?.actors.filter(actor => actor.kind === 'player') || []).sort(compareActors),
	bosses: (replay.value?.actors.filter(actor => actor.kind === 'boss') || []).sort(compareActors),
	adds: (replay.value?.actors.filter(actor => actor.kind === 'add') || []).sort(compareActors),
	mechanics: (replay.value?.actors.filter(actor => actor.kind === 'mechanic') || []).sort(compareActors),
}));

function toggleKind(kind: ReplayActorKind): void {
	const next = new Set(visibleKinds.value);
	if (next.has(kind)) next.delete(kind);
	else next.add(kind);
	visibleKinds.value = next;
}

function selectActor(key: string): void {
	selectedActorKey.value = selectedActorKey.value === key ? null : key;
	viewport.followActors();
}

function seek(timestampMs: number): void {
	const duration = replay.value?.duration || 0;
	const nextTimestamp = Math.max(0, Math.min(duration, timestampMs));
	previewTimestamp.value = nextTimestamp;
	scrubbing.value = false;
	emit('seek', nextTimestamp / 1000);
}

function seekBy(seconds: number): void {
	seek(timestamp.value + seconds * 1000);
}

function previewSeek(event: Event): void {
	scrubbing.value = true;
	previewTimestamp.value = Number((event.target as HTMLInputElement).value);
}

function cancelSeekPreview(): void {
	scrubbing.value = false;
	previewTimestamp.value = null;
}

function formatTime(timestampMs: number): string {
	const seconds = timestampMs / 1000;
	return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}
</script>

<template>
	<section class="replay">
		<div v-if="loading" class="replay-state" role="status">Loading fight replay...</div>
		<div v-else-if="error" class="replay-state replay-error" role="alert">
			<span>{{ error }}</span>
			<button type="button" @click="loadReplay">Retry</button>
		</div>
		<div v-else-if="replay && replay.actors.length === 0" class="replay-state">
			No observed positions are available for this pull.
		</div>
		<template v-else-if="replay">
			<div class="replay-stage">
				<div class="stage-heading">
					<span>Observed positions</span>
					<span>{{ visibleActors.length }} actors / {{ gridSpacing }} yd grid</span>
				</div>

				<svg
					ref="replayCanvas"
					:viewBox="viewport.viewBox.value"
					:class="{ dragging: viewport.dragging.value }"
					@wheel.prevent="viewport.onWheel"
					@pointerdown.prevent="viewport.startPan"
					@pointermove="viewport.movePan"
					@pointerup="viewport.endPan"
					@pointercancel="viewport.endPan"
					@lostpointercapture="viewport.endPan"
				>
					<ReviewReplayMapBackground
						v-if="showMap && mapDefinition"
						:definition="mapDefinition"
						:viewport="mapViewport"
					/>
					<line
						v-for="x in verticalGrid"
						:key="`x:${x}`"
						:x1="x"
						:x2="x"
						:y1="viewport.view.value.y - viewport.view.value.height / 2"
						:y2="viewport.view.value.y + viewport.view.value.height / 2"
						class="grid-line"
						:stroke-width="unit * 0.7"
					/>
					<line
						v-for="y in horizontalGrid"
						:key="`y:${y}`"
						:x1="viewport.view.value.x - viewport.viewWidth.value / 2"
						:x2="viewport.view.value.x + viewport.viewWidth.value / 2"
						:y1="y"
						:y2="y"
						class="grid-line"
						:stroke-width="unit * 0.7"
					/>
					<component
						:is="extensionRenderer"
						v-if="extensionRenderer"
						:replay="replay"
						:timestamp="timestamp"
						:unit="unit"
						:actor-positions="visibleActorPositions"
					/>
					<ReviewReplayActor
						v-for="entry in visibleActors"
						:key="entry.actor.key"
						:transform="`translate(${entry.position.x} ${entry.position.y})`"
						:actor="entry.actor"
						:position="entry.position"
						:cast="entry.cast"
						:timestamp="timestamp"
						:unit="unit"
						:show-name="showNames"
						:selected="selectedActorKey === entry.actor.key"
						:opacity="!entry.cast && entry.position.age > 3000 ? 0.55 : 1"
						@select="selectActor(entry.actor.key)"
					/>
				</svg>

				<div class="stage-legend">
					<span><i class="player"></i> Player</span>
					<span><i class="boss"></i> Boss</span>
					<span><i class="add"></i> Add</span>
					<span v-if="actorGroups.mechanics.length"><i class="mechanic"></i> Mechanic</span>
					<span class="legend-note">Observed positions are briefly interpolated. Cast bars use replay time.</span>
				</div>
			</div>

			<div class="replay-control-deck">
				<div class="replay-progress-row">
					<strong class="replay-time">{{ formatTime(timestamp) }}</strong>
					<input
						aria-label="Seek fight replay and video"
						type="range"
						min="0"
						:max="replay.duration"
						step="100"
						:value="timestamp"
						@input="previewSeek"
						@change="seek(Number(($event.target as HTMLInputElement).value))"
						@pointercancel="cancelSeekPreview"
					/>
					<span class="replay-duration">{{ formatTime(replay.duration) }}</span>
				</div>

				<div class="replay-command-row">
					<div class="replay-command-side replay-command-side-left">
						<label class="control-group replay-focus">
							<span class="control-label">Focus</span>
							<select v-model="selectedActorKey" @change="viewport.followActors">
								<option :value="null">Raid</option>
								<optgroup v-if="actorGroups.players.length" label="Players">
									<option v-for="actor in actorGroups.players" :key="actor.key" :value="actor.key">
										{{ actor.name }}
									</option>
								</optgroup>
								<optgroup v-if="actorGroups.bosses.length" label="Bosses">
									<option v-for="actor in actorGroups.bosses" :key="actor.key" :value="actor.key">
										{{ actor.name }}
									</option>
								</optgroup>
								<optgroup v-if="actorGroups.adds.length" label="Adds">
									<option v-for="actor in actorGroups.adds" :key="actor.key" :value="actor.key">
										{{ actorOptionLabel(actor) }}
									</option>
								</optgroup>
								<optgroup v-if="actorGroups.mechanics.length" label="Mechanics">
									<option v-for="actor in actorGroups.mechanics" :key="actor.key" :value="actor.key">
										{{ actor.name }}
									</option>
								</optgroup>
							</select>
						</label>

						<div class="control-group replay-visibility" aria-label="Visible actors">
							<button
								v-for="option in actorKindOptions"
								:key="option.kind"
								type="button"
								:aria-pressed="visibleKinds.has(option.kind)"
								@click="toggleKind(option.kind)"
							>
								{{ option.label }}
							</button>
							<button type="button" :aria-pressed="showNames" @click="showNames = !showNames">Names</button>
							<button
								v-if="mapDefinition"
								type="button"
								:aria-pressed="showMap"
								@click="showMap = !showMap"
							>
								Map
							</button>
						</div>
					</div>

					<div class="replay-transport" aria-label="Replay transport controls">
						<button type="button" title="Go to pull start" aria-label="Go to pull start" @click="seek(0)">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h2v14H4V3Zm12 1.5v11L7.5 10 16 4.5Z" /></svg>
						</button>
						<button type="button" title="Back 5 seconds" aria-label="Back 5 seconds" @click="seekBy(-5)">
							<span class="seek-step">-5</span>
						</button>
						<button
							type="button"
							class="playback-toggle"
							:title="playing ? 'Pause video' : 'Play video'"
							:aria-label="playing ? 'Pause video' : 'Play video'"
							:aria-pressed="playing"
							@click="emit('togglePlayback')"
						>
							<svg v-if="playing" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h3.5v12H5V4Zm6.5 0H15v12h-3.5V4Z" /></svg>
							<svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="m6 3.5 10 6.5L6 16.5v-13Z" /></svg>
						</button>
						<button type="button" title="Forward 5 seconds" aria-label="Forward 5 seconds" @click="seekBy(5)">
							<span class="seek-step">+5</span>
						</button>
						<button type="button" title="Go to pull end" aria-label="Go to pull end" @click="seek(replay.duration)">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M14 3h2v14h-2V3ZM4 4.5 12.5 10 4 15.5v-11Z" /></svg>
						</button>
					</div>

					<div class="replay-command-side replay-command-side-right">
						<div class="control-group replay-camera">
							<button type="button" :aria-pressed="viewport.follow.value" @click="viewport.followActors">Follow</button>
							<button type="button" @click="viewport.showWholePull">Whole pull</button>
						</div>
						<div class="control-group replay-zoom">
							<button type="button" aria-label="Zoom out" @click="viewport.zoomBy(1 / 1.25)">-</button>
							<span>{{ Math.round(viewport.zoom.value * 100) }}%</span>
							<button type="button" aria-label="Zoom in" @click="viewport.zoomBy(1.25)">+</button>
						</div>
						<button type="button" class="reload" title="Reload replay" aria-label="Reload replay" @click="loadReplay">
							&#8635;
						</button>
					</div>
				</div>
			</div>
		</template>
	</section>
</template>

<style scoped>
.replay {
	display: flex;
	min-width: 0;
	min-height: 0;
	flex: 1;
	flex-direction: column;
	overflow: hidden;
	background: rgb(15 23 42 / 38%);
	color: #d4d4d8;
}

.replay-state {
	display: flex;
	flex: 1;
	align-items: center;
	justify-content: center;
	gap: 10px;
	color: #737b87;
	font-size: 12px;
}

.replay-error {
	color: #ef4444;
}

.replay-state button {
	border: 1px solid rgb(113 113 122 / 35%);
	padding: 3px 9px;
}

.replay-control-deck {
	z-index: 2;
	flex-shrink: 0;
	border-top: 1px solid rgb(113 113 122 / 32%);
	background: linear-gradient(180deg, rgb(30 39 52 / 96%), rgb(20 28 39 / 98%));
	box-shadow: 0 -3px 9px rgb(0 0 0 / 24%);
	font-size: 10px;
}

.replay-progress-row {
	display: grid;
	height: 31px;
	grid-template-columns: 54px minmax(80px, 1fr) 54px;
	align-items: center;
	gap: 9px;
	border-bottom: 1px solid rgb(113 113 122 / 24%);
	padding: 0 10px;
}

.replay-time,
.replay-duration {
	font-size: 11px;
	font-variant-numeric: tabular-nums;
}

.replay-time {
	color: #e0f2fe;
	text-align: right;
}

.replay-duration {
	color: #7f8792;
}

.replay-progress-row input {
	width: 100%;
	height: 4px;
	appearance: none;
	cursor: ew-resize;
	background: rgb(113 113 122 / 48%);
}

.replay-progress-row input::-webkit-slider-thumb {
	width: 9px;
	height: 17px;
	appearance: none;
	cursor: ew-resize;
	border: 1px solid rgb(186 230 253 / 80%);
	border-radius: 0;
	background: #38bdf8;
	box-shadow: 0 0 5px rgb(56 189 248 / 28%);
}

.replay-command-row {
	display: grid;
	min-height: 40px;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: 10px;
	padding: 4px 10px;
}

.replay-command-side,
.control-group,
.replay-transport {
	display: flex;
	min-width: 0;
	align-items: center;
}

.replay-command-side {
	gap: 6px;
}

.replay-command-side-right {
	justify-content: flex-end;
}

.control-group {
	height: 25px;
	gap: 3px;
	border-right: 1px solid rgb(113 113 122 / 28%);
	padding-right: 6px;
}

.control-label {
	color: #89919c;
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
}

.replay-control-deck select {
	height: 23px;
	max-width: 150px;
	border: 1px solid rgb(113 113 122 / 38%);
	background: rgb(5 10 17 / 48%);
	padding: 0 5px;
	color: #d4d4d8;
	outline: none;
}

.replay-control-deck button {
	height: 23px;
	cursor: pointer;
	border: 1px solid rgb(113 113 122 / 32%);
	background: rgb(0 0 0 / 12%);
	padding: 0 7px;
	color: #a1a1aa;
	font-weight: 500;
}

.replay-control-deck button:hover {
	border-color: rgb(56 189 248 / 48%);
	background: rgb(14 165 233 / 9%);
	color: #bae6fd;
}

.replay-control-deck button[aria-pressed="true"] {
	border-color: rgb(56 189 248 / 55%);
	background: rgb(14 165 233 / 14%);
	color: #7dd3fc;
}

.replay-visibility {
	overflow: hidden;
}

.replay-transport {
	justify-content: center;
	gap: 3px;
	padding: 0 4px;
}

.replay-transport button {
	display: flex;
	width: 27px;
	height: 27px;
	align-items: center;
	justify-content: center;
	padding: 0;
}

.replay-transport svg {
	width: 14px;
	height: 14px;
	fill: currentColor;
}

.replay-transport .playback-toggle {
	width: 34px;
	height: 31px;
	border-color: rgb(56 189 248 / 52%);
	background: rgb(14 165 233 / 13%);
	color: #bae6fd;
}

.replay-transport .playback-toggle svg {
	width: 17px;
	height: 17px;
}

.seek-step {
	font-size: 9px;
	font-weight: 800;
	font-variant-numeric: tabular-nums;
}

.replay-zoom {
	gap: 0;
}

.replay-zoom button {
	width: 23px;
	padding: 0;
	font-size: 14px;
}

.replay-zoom span {
	width: 38px;
	color: #8f96a1;
	font-variant-numeric: tabular-nums;
	text-align: center;
}

.reload {
	width: 24px;
	flex-shrink: 0;
	padding: 0 !important;
	font-size: 14px;
}

.replay-stage {
	display: flex;
	min-height: 0;
	flex: 1;
	flex-direction: column;
	overflow: hidden;
	background-color: #080d14;
	background-image:
		linear-gradient(45deg, rgb(255 255 255 / 1.2%) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 1.2%) 75%),
		linear-gradient(45deg, rgb(255 255 255 / 1.2%) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 1.2%) 75%);
	background-position: 0 0, 12px 12px;
	background-size: 24px 24px;
}

.stage-heading,
.stage-legend {
	display: flex;
	height: 24px;
	flex-shrink: 0;
	align-items: center;
	justify-content: space-between;
	border-bottom: 1px solid rgb(113 113 122 / 22%);
	background: rgb(31 41 55 / 68%);
	padding: 0 8px;
	color: #8f96a1;
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
}

.replay-stage svg {
	display: block;
	width: 100%;
	height: 100%;
	min-height: 0;
	flex: 1;
	cursor: grab;
	touch-action: none;
	user-select: none;
}

.replay-stage svg.dragging {
	cursor: grabbing;
}

.grid-line {
	stroke: rgb(148 163 184 / 10%);
}

.stage-legend {
	justify-content: flex-start;
	gap: 14px;
	border-top: 1px solid rgb(113 113 122 / 22%);
	border-bottom: 0;
	letter-spacing: 0;
	text-transform: none;
}

.stage-legend span {
	display: flex;
	align-items: center;
	gap: 4px;
}

.stage-legend i {
	display: block;
	width: 7px;
	height: 7px;
	border: 1px solid;
}

.stage-legend .player {
	border-color: #64748b;
	border-radius: 50%;
}

.stage-legend .boss {
	border-color: #ef4444;
	border-radius: 50%;
}

.stage-legend .add {
	transform: rotate(45deg);
	border-color: #d6a84b;
}

.stage-legend .mechanic {
	border-color: #a78bfa;
	border-radius: 50%;
}

.legend-note {
	margin-left: auto;
	color: #6b7280;
	font-weight: 400;
}

@media (max-width: 1050px) {
	.replay-command-row {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.replay-command-side-left {
		grid-column: 1 / -1;
		justify-content: center;
	}

	.replay-transport {
		grid-column: 1;
		grid-row: 2;
		justify-content: flex-start;
	}

	.replay-command-side-right {
		grid-column: 2;
		grid-row: 2;
	}
}

@media (max-width: 700px) {
	.control-label,
	.replay-camera {
		display: none;
	}

	.replay-command-row {
		padding-inline: 6px;
	}

	.replay-visibility button {
		padding-inline: 5px;
	}
}
</style>
