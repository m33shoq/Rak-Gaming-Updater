import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/reviewSynchronization.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const sync = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const seekCoordinatorSource = readFileSync(
	new URL('../app/renderer/reviewSeekCoordinator.ts', import.meta.url),
	'utf8',
);
const seekCoordinatorJs = ts.transpileModule(seekCoordinatorSource, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const seekCoordinator = await import(
	`data:text/javascript;base64,${Buffer.from(seekCoordinatorJs).toString('base64')}`
);

test('video/log timestamp mapping is reversible with and without an anchor', () => {
	const videoStart = 1_000_000;
	const logTimestamp = 1_042_000;
	const fallbackVideoTime = sync.getReviewVideoTimeForLogTimestamp(null, videoStart, logTimestamp, 5);
	assert.equal(fallbackVideoTime, 47);
	assert.equal(sync.getReviewLogTimestampForVideoTime(null, videoStart, fallbackVideoTime, 5), logTimestamp);

	const anchor = sync.createReviewSyncAnchor('video', 12.5, 2_000_000);
	const anchoredVideoTime = sync.getReviewVideoTimeForLogTimestamp(anchor, videoStart, 2_020_000, 5);
	assert.equal(anchoredVideoTime, 20);
	assert.equal(sync.getReviewLogTimestampForVideoTime(anchor, videoStart, anchoredVideoTime, 5), 2_020_000);
});

test('manual stream offsets shift both anchored and fallback mappings reversibly', () => {
	const videoStart = 1_000_000;
	const logTimestamp = 1_042_000;
	const fallbackVideoTime = sync.getReviewVideoTimeForLogTimestamp(
		null,
		videoStart,
		logTimestamp,
		5,
		1.5,
	);
	assert.equal(fallbackVideoTime, 48.5);
	assert.equal(
		sync.getReviewLogTimestampForVideoTime(null, videoStart, fallbackVideoTime, 5, 1.5),
		logTimestamp,
	);

	const anchor = sync.createReviewSyncAnchor('video', 12.5, 2_000_000);
	const anchoredVideoTime = sync.getReviewVideoTimeForLogTimestamp(
		anchor,
		videoStart,
		2_020_000,
		5,
		-0.75,
	);
	assert.equal(anchoredVideoTime, 19.25);
	assert.equal(
		sync.getReviewLogTimestampForVideoTime(anchor, videoStart, anchoredVideoTime, 5, -0.75),
		2_020_000,
	);
	assert.equal(sync.getReviewMarkerTimestampForLogTimestamp(2_020_000, -0.75), 2_019_250);
});

test('an anchor is active only for its selected video', () => {
	const anchor = sync.createReviewSyncAnchor('first', 10, 5_000);
	assert.equal(sync.getActiveReviewSyncAnchor(anchor, 'first'), anchor);
	assert.equal(sync.getActiveReviewSyncAnchor(anchor, 'second'), null);
});

test('automatic re-anchors require two recent consistent measurements', () => {
	const base = {
		automatic: true,
		videoId: 'video',
		differenceMs: 600,
		markerTimelineOriginMs: 10_000,
		observedAt: 1_000,
		pendingCandidate: null,
		reanchorThresholdMs: 250,
		confirmationToleranceMs: 250,
		confirmationMaxAgeMs: 30_000,
	};
	const first = sync.evaluateReviewSyncReanchor(base);
	assert.equal(first.apply, false);
	assert.equal(first.confirmPromptly, true);

	const confirmed = sync.evaluateReviewSyncReanchor({
		...base,
		differenceMs: 650,
		observedAt: 2_000,
		pendingCandidate: first.pendingCandidate,
	});
	assert.deepEqual(confirmed, {
		apply: true,
		pendingCandidate: null,
		confirmPromptly: false,
	});

	const stale = sync.evaluateReviewSyncReanchor({
		...base,
		observedAt: 32_000,
		pendingCandidate: first.pendingCandidate,
	});
	assert.equal(stale.apply, false);
	assert.equal(stale.confirmPromptly, true);
});

test('manual reads can apply a significant measurement immediately', () => {
	const decision = sync.evaluateReviewSyncReanchor({
		automatic: false,
		videoId: 'video',
		differenceMs: -300,
		markerTimelineOriginMs: 10_000,
		observedAt: 1_000,
		pendingCandidate: null,
		reanchorThresholdMs: 250,
		confirmationToleranceMs: 250,
		confirmationMaxAgeMs: 30_000,
	});
	assert.equal(decision.apply, true);
});

test('interactive review seeks preserve paused playback', () => {
	for (const source of ['timeline', 'comparison', 'detached-timeline', 'hotkey']) {
		assert.equal(seekCoordinator.shouldPlayReviewSeek(source, false), false);
		assert.equal(seekCoordinator.shouldPlayReviewSeek(source, true), true);
	}
});

test('selection and deep-link seeks retain autoplay behavior', () => {
	for (const source of ['fight-selection', 'report-selection', 'video-selection', 'deep-link']) {
		assert.equal(seekCoordinator.shouldPlayReviewSeek(source, false), true);
	}
});

test('player time updates reject the stale side of an app-issued seek', () => {
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(10, 40, 10), false);
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(10, 40, 39.8), true);
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(10, 40, 80), false);
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(40, 10, 40), false);
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(40, 10, 10.2), true);
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(40, 10, 1), false);

	// Frame stepping needs a tighter tolerance than ordinary multi-second seeks.
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(10, 10 + 1 / 30, 10), false);
	assert.equal(seekCoordinator.hasReviewSeekReachedTarget(10, 10 + 1 / 30, 10.03), true);
});
