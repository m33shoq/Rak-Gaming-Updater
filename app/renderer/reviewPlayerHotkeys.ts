import type { ReviewPlayerHotkeyInput } from '@/timelineWindow';

const UNMODIFIED_PLAYER_HOTKEY_CODES = new Set([
	'Space',
	'KeyK',
	'KeyJ',
	'KeyL',
	'KeyM',
	'KeyF',
	'Comma',
	'Period',
]);

export function isExcludedPlayerHotkeyTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;

	return Boolean(target.closest([
		'input',
		'textarea',
		'select',
		'button',
		'a[href]',
		'summary',
		'[contenteditable="true"]',
		'[role="button"]',
		'[role="menuitem"]',
		'[role="option"]',
		'[role="slider"]',
	].join(', ')));
}

export function isReviewPlayerHotkey(input: ReviewPlayerHotkeyInput | KeyboardEvent): boolean {
	if (input.code === 'ArrowLeft' || input.code === 'ArrowRight') return true;
	if (input.altKey || input.ctrlKey || input.metaKey || input.shiftKey) return false;
	return UNMODIFIED_PLAYER_HOTKEY_CODES.has(input.code);
}

export function normalizeReviewPlayerHotkey(event: KeyboardEvent): ReviewPlayerHotkeyInput {
	return {
		key: event.key,
		code: event.code,
		altKey: event.altKey,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		repeat: event.repeat,
		shiftKey: event.shiftKey,
	};
}
