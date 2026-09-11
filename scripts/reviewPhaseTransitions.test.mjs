import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/reviewPhaseTransitions.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const phases = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const definitions = [{
	encounterID: 42,
	phases: [
		{ id: 1, name: 'First phase', isIntermission: false },
		{ id: 2, name: 'Intermission', isIntermission: true },
		{ id: 3, name: 'Second phase', isIntermission: false },
	],
}];

test('phase markers use compact phase and intermission labels', () => {
	const fight = {
		encounterID: 42,
		startTime: 1_000,
		phaseTransitions: [
			{ id: 1, startTime: 1_000 },
			{ id: 2, startTime: 3_000 },
			{ id: 3, startTime: 6_000 },
		],
	};

	assert.deepEqual(phases.buildReviewPhaseMarkers(definitions, fight, 10_000), [
		{ name: 'I1', percent: 0.2 },
		{ name: 'P2', percent: 0.5 },
	]);
});

test('repeated phase IDs retain their labels and occurrence order', () => {
	const fight = {
		encounterID: 42,
		startTime: 0,
		phaseTransitions: [
			{ id: 1, startTime: 0 },
			{ id: 3, startTime: 2_000 },
			{ id: 1, startTime: 4_000 },
			{ id: 3, startTime: 6_000 },
			{ id: 1, startTime: 8_000 },
		],
	};

	assert.deepEqual(phases.buildReviewPhaseMarkers(definitions, fight, 10_000), [
		{ name: 'P2', percent: 0.2 },
		{ name: 'P1', percent: 0.4 },
		{ name: 'P2', percent: 0.6 },
		{ name: 'P1', percent: 0.8 },
	]);
});
