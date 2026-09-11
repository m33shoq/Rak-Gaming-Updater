<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

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
}>();

const emit = defineEmits<{
	readSyncMarker: [];
	openVideo: [event: MouseEvent];
	toggleFullscreen: [];
	dismissSyncStatus: [];
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
const isHotkeyGuideOpen = ref(false);
const areControlsVisible = ref(true);
const isDockHovered = ref(false);
const isDockFocused = ref(false);
let controlsHideTimeout: number | null = null;

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
		|| isDockHovered.value
		|| isDockFocused.value
	) return;

	controlsHideTimeout = window.setTimeout(() => {
		controlsHideTimeout = null;
		if (!isHotkeyGuideOpen.value && !isDockHovered.value && !isDockFocused.value) {
			areControlsVisible.value = false;
		}
	}, PLAYER_CONTROLS_IDLE_MS);
}

function closeHotkeyGuide(): boolean {
	if (!isHotkeyGuideOpen.value) return false;
	isHotkeyGuideOpen.value = false;
	return true;
}

function reset(): void {
	isDockHovered.value = false;
	isDockFocused.value = false;
	isHotkeyGuideOpen.value = false;
	keepControlsVisible();
}

function toggleHotkeyGuide(event: MouseEvent): void {
	if (event.detail > 1) return;
	isHotkeyGuideOpen.value = !isHotkeyGuideOpen.value;
}

function onOutsidePointer(event: PointerEvent): void {
	if (!isHotkeyGuideOpen.value || !(event.target instanceof Node)) return;
	if (hotkeyGuide.value?.contains(event.target) || hotkeyGuideButton.value?.contains(event.target)) return;
	closeHotkeyGuide();
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

watch(() => props.playing, playing => {
	if (playing) revealControls();
	else keepControlsVisible();
});

watch(() => props.selectedVideo, selected => {
	if (!selected) reset();
});

onMounted(() => {
	window.addEventListener('blur', closeHotkeyGuide);
	document.addEventListener('pointerdown', onOutsidePointer);
});

onBeforeUnmount(() => {
	window.removeEventListener('blur', closeHotkeyGuide);
	document.removeEventListener('pointerdown', onOutsidePointer);
	clearControlsHideTimeout();
});

defineExpose({ closeHotkeyGuide, keepControlsVisible, reset, revealControls });
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
