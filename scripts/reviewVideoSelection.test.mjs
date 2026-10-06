import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/reviewVideoSelection.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const selection = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const now = 1_000_000;
const video = (id, startTime, duration) => ({ id, startTime, duration });

test('report filtering includes streams overlapping any part of the report', () => {
	const reportStart = 100_000;
	const reportEnd = 200_000;

	assert.equal(selection.reviewVideoOverlapsWindow(video('before', 50_000, 60_000), reportStart, reportEnd, now), true);
	assert.equal(selection.reviewVideoOverlapsWindow(video('during', 150_000, 20_000), reportStart, reportEnd, now), true);
	assert.equal(selection.reviewVideoOverlapsWindow(video('after', 200_001, 20_000), reportStart, reportEnd, now), false);
});

test('constrained selection follows the available report or fight videos', () => {
	const oldVideo = video('old', 100_000, 20_000);
	const replacement = video('replacement', 200_000, 20_000);

	assert.equal(
		selection.reconcileReviewVideoSelection(oldVideo, [replacement], true),
		replacement,
	);
	assert.equal(selection.reconcileReviewVideoSelection(oldVideo, [], true), null);
	assert.equal(selection.reconcileReviewVideoSelection(oldVideo, [], false), oldVideo);
});

test('only ordinary selected reports constrain videos by report or fight time', () => {
	assert.equal(selection.shouldConstrainReviewVideoSelection('ordinary', false), true);
	assert.equal(selection.shouldConstrainReviewVideoSelection('custom', true), false);
	assert.equal(selection.shouldConstrainReviewVideoSelection(null, false), false);
});
