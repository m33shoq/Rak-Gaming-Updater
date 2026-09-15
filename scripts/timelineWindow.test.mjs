import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/timelineWindow.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const timelineWindow = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('native detached-window close collapses the attached timeline', () => {
	assert.equal(timelineWindow.shouldExpandTimelineAfterReattach({
		reason: 'timeline-closed',
		returnToReviews: false,
	}), false);
});

test('Return to Reviews keeps the reattached timeline expanded', () => {
	assert.equal(timelineWindow.shouldExpandTimelineAfterReattach({
		reason: 'timeline-closed',
		returnToReviews: true,
	}), true);
});

test('automatic reattachment keeps the timeline expanded', () => {
	assert.equal(timelineWindow.shouldExpandTimelineAfterReattach({
		reason: 'main-minimized',
		returnToReviews: false,
	}), true);
	assert.equal(timelineWindow.shouldExpandTimelineAfterReattach({
		reason: 'main-hidden',
		returnToReviews: false,
	}), true);
});
