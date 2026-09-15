export interface ReviewVideoTimeInfo {
	id: string;
	startTime: number;
	duration: number;
}

export function reconcileReviewVideoSelection<T extends { id: string }>(
	selectedVideo: T | null,
	availableVideos: readonly T[],
	selectionIsConstrained: boolean,
): T | null {
	const availableSelection = selectedVideo
		? availableVideos.find(video => video.id === selectedVideo.id)
		: undefined;
	if (availableSelection) return availableSelection;
	return selectionIsConstrained ? availableVideos[0] || null : selectedVideo;
}

const LIVE_VIDEO_FUTURE_BUFFER_MS = 12 * 60 * 60 * 1000;

export function getReviewVideoEndTime(
	video: ReviewVideoTimeInfo,
	now = Date.now(),
): number {
	return video.duration > 0
		? video.startTime + video.duration
		: now + LIVE_VIDEO_FUTURE_BUFFER_MS;
}

export function reviewVideoOverlapsWindow(
	video: ReviewVideoTimeInfo,
	windowStart: number,
	windowEnd: number,
	now = Date.now(),
): boolean {
	return video.startTime <= windowEnd
		&& getReviewVideoEndTime(video, now) >= windowStart;
}
