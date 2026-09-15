<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
	selectedVideo: boolean;
	playing: boolean;
	fullscreen: boolean;
	queuedSeekDeltaSeconds: number | null;
	queuedSeekDeltaLabel: string;
	queuedSeekDirectionClass: string;
	syncStatus: string;
	syncStatusTone: 'success' | 'error' | 'info';
	syncCapturing: boolean;
	manualSyncOffsetSeconds: number;
}>();

const emit = defineEmits<{
	readSyncMarker: [];
	openVideo: [event: MouseEvent];
	toggleFullscreen: [];
	dismissSyncStatus: [];
	setManualSyncOffset: [seconds: number];
}>();

const PLAYER_CONTROLS_IDLE_MS = 2200;
const PLAYER_SHORTCUTS = [
	{ keys: 'Space / K', action: 'Play or pause' },
	{ keys: 'M', action: 'Mute or unmute' },
	{ keys: 'F', action: 'Enter or exit fullscreen' },
	{ keys: '← / →', action: 'Seek 5 seconds' },
	{ keys: 'Alt + ← / →', action: 'Seek 1 second' },
	{ keys: 'Shift + ← / →', action: 'Seek 3 seconds' },
	{ keys: 'Ctrl/Cmd + ← / →', action: 'Seek 60 seconds' },
	{ keys: 'J / L', action: 'Seek 10 seconds' },
	{ keys: ', / .', action: 'Previous or next frame' },
	{ keys: 'Double-click', action: 'Enter or exit fullscreen' },
];

const hotkeyGuide = ref<HTMLElement | null>(null);
const hotkeyGuideButton = ref<HTMLButtonElement | null>(null);
const manualOffsetPanel = ref<HTMLElement | null>(null);
const manualOffsetButton = ref<HTMLButtonElement | null>(null);
const isHotkeyGuideOpen = ref(false);
const isManualOffsetOpen = ref(false);
const areControlsVisible = ref(true);
const isDockHovered = ref(false);
const isDockFocused = ref(false);
let controlsHideTimeout: number | null = null;

const manualOffsetLabel = computed(() => {
	const value = props.manualSyncOffsetSeconds;
	const formatted = Math.abs(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
	return `${value >= 0 ? '+' : '-'}${formatted || '0'}s`;
});

function clearControlsHideTimeout(): void {
	if (controlsHideTimeout === null) return;
	window.clearTimeout(controlsHideTimeout);
	controlsHideTimeout = null;
}

function keepControlsVisible(): void {
	clearControlsHideTimeout();
	areControlsVisible.value = true;
}

function revealControls(): void {
	keepControlsVisible();
	if (
		!props.playing
		|| isHotkeyGuideOpen.value
		|| isManualOffsetOpen.value
		|| isDockHovered.value
		|| isDockFocused.value
	) return;

	controlsHideTimeout = window.setTimeout(() => {
		controlsHideTimeout = null;
		if (
			!isHotkeyGuideOpen.value
			&& !isManualOffsetOpen.value
			&& !isDockHovered.value
			&& !isDockFocused.value
		) {
			areControlsVisible.value = false;
		}
	}, PLAYER_CONTROLS_IDLE_MS);
}

function closeHotkeyGuide(): boolean {
	if (!isHotkeyGuideOpen.value) return false;
	isHotkeyGuideOpen.value = false;
	return true;
}

function closeManualOffsetPanel(): boolean {
	if (!isManualOffsetOpen.value) return false;
	isManualOffsetOpen.value = false;
	return true;
}

function closePopovers(): boolean {
	const closedHotkeys = closeHotkeyGuide();
	const closedOffset = closeManualOffsetPanel();
	return closedHotkeys || closedOffset;
}

function reset(): void {
	isDockHovered.value = false;
	isDockFocused.value = false;
	closePopovers();
	keepControlsVisible();
}

function toggleHotkeyGuide(event: MouseEvent): void {
	if (event.detail > 1) return;
	closeManualOffsetPanel();
	isHotkeyGuideOpen.value = !isHotkeyGuideOpen.value;
}

function toggleManualOffset(event: MouseEvent): void {
	if (event.detail > 1) return;
	closeHotkeyGuide();
	isManualOffsetOpen.value = !isManualOffsetOpen.value;
}

function adjustManualOffset(delta: number): void {
	emit('setManualSyncOffset', props.manualSyncOffsetSeconds + delta);
}

function commitManualOffset(event: Event): void {
	const input = event.currentTarget as HTMLInputElement;
	const value = Number(input.value);
	if (Number.isFinite(value)) emit('setManualSyncOffset', value);
	else input.value = String(props.manualSyncOffsetSeconds);
}

function onOutsidePointer(event: PointerEvent): void {
	if ((!isHotkeyGuideOpen.value && !isManualOffsetOpen.value) || !(event.target instanceof Node)) return;
	if (
		hotkeyGuide.value?.contains(event.target)
		|| hotkeyGuideButton.value?.contains(event.target)
		|| manualOffsetPanel.value?.contains(event.target)
		|| manualOffsetButton.value?.contains(event.target)
	) return;
	closePopovers();
}

function onDockPointerEnter(): void {
	isDockHovered.value = true;
	keepControlsVisible();
}

function onDockPointerLeave(): void {
	isDockHovered.value = false;
	revealControls();
}

function onDockFocusIn(): void {
	isDockFocused.value = true;
	keepControlsVisible();
}

function onDockFocusOut(event: FocusEvent): void {
	const nextTarget = event.relatedTarget;
	if (nextTarget instanceof Node && (event.currentTarget as HTMLElement).contains(nextTarget)) return;
	isDockFocused.value = false;
	revealControls();
}

function onFullscreenClick(event: MouseEvent): void {
	// A double-click emits two click events; only the first should toggle the window.
	if (event.detail > 1) return;
	emit('toggleFullscreen');
}

watch(isHotkeyGuideOpen, open => {
	if (open) keepControlsVisible();
	else revealControls();
});

watch(isManualOffsetOpen, open => {
	if (open) keepControlsVisible();
	else revealControls();
});

watch(() => props.playing, playing => {
	if (playing) revealControls();
	else keepControlsVisible();
});

watch(() => props.selectedVideo, selected => {
	if (!selected) reset();
});

onMounted(() => {
	window.addEventListener('blur', closePopovers);
	document.addEventListener('pointerdown', onOutsidePointer);
});

onBeforeUnmount(() => {
	window.removeEventListener('blur', closePopovers);
	document.removeEventListener('pointerdown', onOutsidePointer);
	clearControlsHideTimeout();
});

defineExpose({ closeHotkeyGuide, closePopovers, keepControlsVisible, reset, revealControls });
</script>

<template>
	<Transition name="youtube-player-seek-queue">
		<div
			v-if="queuedSeekDeltaSeconds !== null"
			class="youtube-player-seek-queue"
			:class="queuedSeekDirectionClass"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<strong>{{ queuedSeekDeltaLabel }}</strong>
		</div>
	</Transition>
	<div
		v-if="selectedVideo"
		class="youtube-player-control-dock"
		:class="{ 'youtube-player-control-dock--hidden': !areControlsVisible }"
		@pointerenter="onDockPointerEnter"
		@pointerleave="onDockPointerLeave"
		@focusin="onDockFocusIn"
		@focusout="onDockFocusOut"
		@dblclick.stop
	>
		<button
			type="button"
			class="youtube-player-control-button"
			:title="syncCapturing ? 'Reading RG sync marker...' : 'Read RG sync marker now (automatic synchronization is enabled)'"
			aria-label="Read RG sync marker from the video"
			:disabled="syncCapturing"
			@click.stop="emit('readSyncMarker')"
			@dblclick.stop
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5M7 10h10v4H7z" />
			</svg>
		</button>
		<button
			ref="manualOffsetButton"
			type="button"
			class="youtube-player-control-button youtube-player-control-button--offset"
			:class="{ 'youtube-player-control-button--active': manualSyncOffsetSeconds !== 0 }"
			:title="$t('reviews.manual_alignment_offset', { offset: manualOffsetLabel })"
			:aria-label="$t('reviews.adjust_manual_alignment')"
			aria-controls="youtube-player-manual-offset"
			:aria-expanded="isManualOffsetOpen"
			@click.stop="toggleManualOffset"
			@dblclick.stop
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M4 7h16M7 4 4 7l3 3M20 17H4m13-3 3 3-3 3M12 10v4" />
			</svg>
			<span v-if="manualSyncOffsetSeconds !== 0">{{ manualOffsetLabel }}</span>
		</button>
		<button
			type="button"
			class="youtube-player-control-button"
			title="Open video on YouTube"
			aria-label="Open current video on YouTube"
			@click.stop="emit('openVideo', $event)"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
			</svg>
		</button>
		<button
			ref="hotkeyGuideButton"
			type="button"
			class="youtube-player-control-button"
			title="Video keyboard shortcuts"
			aria-label="Show video keyboard shortcuts"
			aria-controls="youtube-player-hotkey-guide"
			:aria-expanded="isHotkeyGuideOpen"
			@click.stop="toggleHotkeyGuide"
			@dblclick.stop
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<rect x="2.5" y="5" width="19" height="14" rx="1" />
				<path d="M6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h3M6 15h12" />
			</svg>
		</button>
		<button
			type="button"
			class="youtube-player-control-button"
			:title="fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'"
			:aria-label="fullscreen ? 'Exit video fullscreen' : 'Enter video fullscreen'"
			@click.stop="onFullscreenClick"
			@dblclick.stop
		>
			<svg v-if="fullscreen" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
			</svg>
			<svg v-else viewBox="0 0 24 24" aria-hidden="true">
				<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
			</svg>
		</button>
	</div>
	<section
		v-if="isManualOffsetOpen"
		id="youtube-player-manual-offset"
		ref="manualOffsetPanel"
		class="youtube-player-manual-offset"
		:aria-label="$t('reviews.manual_stream_alignment')"
		@dblclick.stop
	>
		<div class="youtube-player-manual-offset__heading">
			<strong>{{ $t('reviews.manual_alignment') }}</strong>
			<button type="button" :aria-label="$t('reviews.close_manual_alignment')" @click="closeManualOffsetPanel">×</button>
		</div>
		<p>{{ $t('reviews.manual_alignment_description') }}</p>
		<div class="youtube-player-manual-offset__controls">
			<button type="button" :title="$t('reviews.move_video_earlier', { seconds: 1 })" @click="adjustManualOffset(-1)">−1</button>
			<button type="button" :title="$t('reviews.move_video_earlier', { seconds: 0.1 })" @click="adjustManualOffset(-0.1)">−0.1</button>
			<label>
				<input
					type="number"
					:value="String(manualSyncOffsetSeconds)"
					min="-300"
					max="300"
					step="0.1"
					:aria-label="$t('reviews.manual_alignment_seconds')"
					@change="commitManualOffset"
				>
				<span>s</span>
			</label>
			<button type="button" :title="$t('reviews.move_video_later', { seconds: 0.1 })" @click="adjustManualOffset(0.1)">+0.1</button>
			<button type="button" :title="$t('reviews.move_video_later', { seconds: 1 })" @click="adjustManualOffset(1)">+1</button>
			<button type="button" class="youtube-player-manual-offset__reset" @click="emit('setManualSyncOffset', 0)">{{ $t('reviews.reset') }}</button>
		</div>
	</section>
	<div
		v-if="syncStatus"
		class="youtube-player-sync-prototype"
		:class="`youtube-player-sync-prototype--${syncStatusTone}`"
		role="status"
		@dblclick.stop
	>
		<span>{{ syncStatus }}</span>
		<button type="button" @click.stop="emit('dismissSyncStatus')">Close</button>
	</div>
	<section
		v-if="isHotkeyGuideOpen"
		id="youtube-player-hotkey-guide"
		ref="hotkeyGuide"
		class="youtube-player-hotkey-guide"
		aria-label="Video keyboard shortcuts"
		@dblclick.stop
	>
		<div class="youtube-player-hotkey-guide__header">
			<div>
				<div class="youtube-player-hotkey-guide__title">Video shortcuts</div>
				<div class="youtube-player-hotkey-guide__hint">Available while reviewing a video</div>
			</div>
			<button type="button" aria-label="Close video shortcuts" @click="closeHotkeyGuide">×</button>
		</div>
		<div class="youtube-player-hotkey-guide__grid">
			<div
				v-for="shortcut in PLAYER_SHORTCUTS"
				:key="shortcut.keys"
				class="youtube-player-hotkey-guide__item"
			>
				<kbd>{{ shortcut.keys }}</kbd>
				<span>{{ shortcut.action }}</span>
			</div>
		</div>
	</section>
</template>

<style scoped>
.youtube-player-seek-queue {
	position: absolute;
	top: 50%;
	z-index: 60;
	transform: translate(-50%, -50%);
	color: rgb(241 245 249);
	pointer-events: none;
	text-align: center;
	text-shadow: 0 2px 5px rgb(0 0 0 / 95%), 0 0 16px rgb(0 0 0 / 75%);
}

.youtube-player-seek-queue--backward {
	left: 22%;
}

.youtube-player-seek-queue--forward {
	left: 78%;
}

.youtube-player-seek-queue--neutral {
	left: 50%;
}

.youtube-player-seek-queue strong {
	font-size: clamp(2.1rem, 5vw, 4rem);
	font-weight: 750;
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.04em;
	line-height: 0.9;
}

.youtube-player-seek-queue-enter-active,
.youtube-player-seek-queue-leave-active {
	transition: left 80ms ease-out, opacity 80ms linear, transform 80ms linear;
}

.youtube-player-seek-queue-enter-from,
.youtube-player-seek-queue-leave-to {
	opacity: 0;
	transform: translate(-50%, -50%) scale(0.92);
}

.youtube-player-control-dock {
	position: absolute;
	right: 0.65rem;
	bottom: 3.35rem;
	z-index: 2;
	display: flex;
	align-items: center;
	border: 1px solid rgb(148 163 184 / 45%);
	border-radius: 0.2rem;
	background: rgb(8 13 22 / 88%);
	color: rgb(241 245 249);
	box-shadow: 0 2px 8px rgb(0 0 0 / 55%);
	opacity: 0.86;
	overflow: hidden;
	transition: border-color 80ms linear, opacity 220ms ease-out;
}

.youtube-player-control-dock--hidden {
	opacity: 0;
	pointer-events: none;
}

.youtube-player-control-dock:hover,
.youtube-player-control-dock:focus-within {
	border-color: rgb(165 180 252 / 72%);
	opacity: 1;
}

.youtube-player-control-button {
	display: flex;
	width: 2.2rem;
	height: 2.1rem;
	align-items: center;
	justify-content: center;
	border-left: 1px solid rgb(100 116 139 / 42%);
	background: transparent;
	color: inherit;
	cursor: pointer;
	transition: background-color 80ms linear, color 80ms linear;
}

.youtube-player-control-button--offset {
	width: auto;
	min-width: 2.2rem;
	gap: 0.25rem;
	padding: 0 0.45rem;
}

.youtube-player-control-button--offset span {
	font-size: 0.68rem;
	font-variant-numeric: tabular-nums;
	font-weight: 700;
}

.youtube-player-control-button--active {
	color: rgb(125 211 252);
}

.youtube-player-control-button:first-child {
	border-left: 0;
}

.youtube-player-control-button:hover,
.youtube-player-control-button:focus-visible {
	background: rgb(30 41 59 / 96%);
	color: white;
}

.youtube-player-control-button:disabled {
	cursor: wait;
	opacity: 0.45;
}

.youtube-player-control-button:focus-visible {
	outline: 2px solid rgb(129 140 248 / 85%);
	outline-offset: -2px;
}

.youtube-player-control-button svg {
	width: 1.25rem;
	height: 1.25rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: square;
	stroke-linejoin: miter;
}

.youtube-player-control-button svg rect {
	fill: none;
}

.youtube-player-control-button svg path {
	stroke-linecap: round;
	stroke-linejoin: round;
}

.youtube-player-sync-prototype {
	position: absolute;
	top: 0.65rem;
	right: 0.65rem;
	z-index: 3;
	display: flex;
	max-width: min(48rem, calc(100% - 1.3rem));
	align-items: center;
	gap: 0.55rem;
	padding: 0.38rem 0.5rem;
	border: 1px solid rgb(71 85 105 / 80%);
	border-radius: 0.15rem;
	background: rgb(8 13 22 / 94%);
	box-shadow: 0 2px 8px rgb(0 0 0 / 65%);
	color: rgb(203 213 225);
	font-size: 0.72rem;
	font-variant-numeric: tabular-nums;
	line-height: 1.2;
}

.youtube-player-sync-prototype--success {
	border-color: rgb(45 212 191 / 70%);
	color: rgb(153 246 228);
}

.youtube-player-sync-prototype--error {
	border-color: rgb(248 113 113 / 75%);
	color: rgb(254 202 202);
}

.youtube-player-sync-prototype button {
	padding-left: 0.5rem;
	border-left: 1px solid rgb(100 116 139 / 55%);
	color: rgb(226 232 240);
	font-weight: 700;
	text-transform: uppercase;
}

.youtube-player-sync-prototype button:hover,
.youtube-player-sync-prototype button:focus-visible {
	color: white;
}

.youtube-player-manual-offset {
	position: absolute;
	right: 0.65rem;
	bottom: 5.9rem;
	z-index: 4;
	width: min(27rem, calc(100% - 1.3rem));
	padding: 0.65rem;
	border: 1px solid rgb(100 116 139 / 58%);
	border-radius: 0.2rem;
	background: rgb(7 12 20 / 96%);
	color: rgb(226 232 240);
	box-shadow: 0 12px 32px rgb(0 0 0 / 62%);
	backdrop-filter: blur(5px);
}

.youtube-player-manual-offset__heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-size: 0.85rem;
}

.youtube-player-manual-offset__heading button {
	color: rgb(148 163 184);
	font-size: 1.1rem;
	line-height: 1;
}

.youtube-player-manual-offset p {
	margin-top: 0.2rem;
	color: rgb(148 163 184);
	font-size: 0.68rem;
}

.youtube-player-manual-offset__controls {
	display: flex;
	align-items: stretch;
	gap: 0.25rem;
	margin-top: 0.55rem;
}

.youtube-player-manual-offset__controls > button,
.youtube-player-manual-offset__controls label {
	min-height: 1.9rem;
	border: 1px solid rgb(71 85 105 / 85%);
	border-radius: 0.12rem;
	background: rgb(15 23 42 / 92%);
}

.youtube-player-manual-offset__controls > button {
	padding: 0 0.45rem;
	font-size: 0.7rem;
	font-weight: 700;
}

.youtube-player-manual-offset__controls > button:hover,
.youtube-player-manual-offset__controls > button:focus-visible {
	border-color: rgb(125 211 252 / 75%);
	background: rgb(30 41 59);
}

.youtube-player-manual-offset__controls label {
	display: flex;
	min-width: 5.2rem;
	flex: 1;
	align-items: center;
	padding-right: 0.4rem;
	color: rgb(148 163 184);
}

.youtube-player-manual-offset__controls input {
	min-width: 0;
	width: 100%;
	padding: 0 0.25rem 0 0.45rem;
	background: transparent;
	color: white;
	font-size: 0.75rem;
	font-variant-numeric: tabular-nums;
	outline: none;
}

.youtube-player-manual-offset__reset {
	color: rgb(148 163 184);
}

.youtube-player-hotkey-guide {
	position: absolute;
	right: 0.65rem;
	bottom: 5.9rem;
	z-index: 3;
	width: min(38rem, calc(100% - 1.3rem));
	max-height: calc(100% - 4rem);
	overflow: auto;
	border: 1px solid rgb(100 116 139 / 58%);
	border-radius: 0.25rem;
	background: rgb(7 12 20 / 96%);
	color: rgb(226 232 240);
	box-shadow: 0 12px 32px rgb(0 0 0 / 62%);
	backdrop-filter: blur(5px);
}

.youtube-player-hotkey-guide__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.7rem 0.8rem 0.6rem;
	border-bottom: 1px solid rgb(71 85 105 / 50%);
}

.youtube-player-hotkey-guide__title {
	font-size: 0.9rem;
	font-weight: 700;
	letter-spacing: 0.02em;
}

.youtube-player-hotkey-guide__hint {
	margin-top: 0.1rem;
	font-size: 0.7rem;
	color: rgb(148 163 184);
}

.youtube-player-hotkey-guide__header button {
	font-size: 1.25rem;
	line-height: 1;
	color: rgb(148 163 184);
	cursor: pointer;
}

.youtube-player-hotkey-guide__header button:hover,
.youtube-player-hotkey-guide__header button:focus-visible {
	color: white;
}

.youtube-player-hotkey-guide__grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.4rem 0.8rem;
	padding: 0.7rem 0.8rem 0.8rem;
}

.youtube-player-hotkey-guide__item {
	display: flex;
	min-width: 0;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	font-size: 0.75rem;
	color: rgb(203 213 225);
}

.youtube-player-hotkey-guide__item kbd {
	flex: none;
	min-width: 3rem;
	padding: 0.18rem 0.35rem;
	border: 1px solid rgb(100 116 139 / 60%);
	border-bottom-color: rgb(148 163 184 / 75%);
	border-radius: 0.18rem;
	background: rgb(30 41 59 / 82%);
	color: rgb(241 245 249);
	font-family: inherit;
	font-size: 0.68rem;
	font-weight: 650;
	line-height: 1.2;
	text-align: center;
	white-space: nowrap;
}
</style>
