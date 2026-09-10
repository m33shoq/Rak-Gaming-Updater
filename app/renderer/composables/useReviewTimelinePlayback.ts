import { inject, type InjectionKey, type Ref } from 'vue';

export type ReviewTimelinePlayback = {
	cursorPercent: Readonly<Ref<number>>;
	playing: Readonly<Ref<boolean>>;
};

export type ReviewTimelineCursorMapping = {
	fightDurationSeconds: number;
	timelineOriginSeconds: number;
	timelineStartSeconds: number;
	timelineDurationSeconds: number;
};

export const reviewTimelinePlaybackKey: InjectionKey<ReviewTimelinePlayback> = Symbol('review-timeline-playback');

export function createReviewTimelinePlayback(
	cursorPercent: Readonly<Ref<number>>,
	playing: Readonly<Ref<boolean>>,
): ReviewTimelinePlayback {
	// Keep this container non-reactive. Consumers subscribe to the two refs directly,
	// so a playback tick never changes a prop on the large timeline components.
	return Object.freeze({ cursorPercent, playing });
}

export function useReviewTimelinePlayback(): ReviewTimelinePlayback {
	const playback = inject(reviewTimelinePlaybackKey);
	if (!playback) throw new Error('Review timeline playback state was not provided');
	return playback;
}
