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

test('fight selection keeps a fitting current stream', () => {
	const current = video('current', 50_000, 200_000);
	const newer = video('newer', 75_000, 150_000);
	assert.equal(
		selection.chooseReviewVideoForWindow([newer, current], current, 100_000, 200_000, now),
		current,
	);
});

test('fight selection prefers full coverage and falls back to overlap', () => {
	const unrelated = video('unrelated', 10_000, 20_000);
	const partial = video('partial', 150_000, 20_000);
	const complete = video('complete', 90_000, 120_000);

	assert.equal(
		selection.chooseReviewVideoForWindow([partial, complete], partial, 100_000, 200_000, now),
		complete,
	);
	assert.equal(
		selection.chooseReviewVideoForWindow([partial], unrelated, 100_000, 200_000, now),
		partial,
	);
});
