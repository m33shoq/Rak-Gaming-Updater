export interface ReviewVideoTimeInfo {
	id: string;
	startTime: number;
	duration: number;
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

export function reviewVideoCoversWindow(
	video: ReviewVideoTimeInfo,
	windowStart: number,
	windowEnd: number,
	now = Date.now(),
): boolean {
	return video.startTime <= windowStart
		&& getReviewVideoEndTime(video, now) >= windowEnd;
}

/**
 * Keep the current stream when it covers the pull. Otherwise prefer the first
 * fully covering stream in the caller's display order. A partial overlap is a
 * useful last resort when no stream contains the complete pull.
 */
export function chooseReviewVideoForWindow<T extends ReviewVideoTimeInfo>(
	videos: readonly T[],
	currentVideo: T | null,
	windowStart: number,
	windowEnd: number,
	now = Date.now(),
): T | null {
	const availableCurrent = currentVideo
		? videos.find(video => video.id === currentVideo.id) || null
		: null;

	if (availableCurrent && reviewVideoCoversWindow(availableCurrent, windowStart, windowEnd, now)) {
		return availableCurrent;
	}

	const coveringVideo = videos.find(video => (
		reviewVideoCoversWindow(video, windowStart, windowEnd, now)
	));
	if (coveringVideo) return coveringVideo;

	if (availableCurrent && reviewVideoOverlapsWindow(availableCurrent, windowStart, windowEnd, now)) {
		return availableCurrent;
	}

	return videos.find(video => (
		reviewVideoOverlapsWindow(video, windowStart, windowEnd, now)
	)) || null;
}
