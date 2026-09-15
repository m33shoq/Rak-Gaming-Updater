import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/reviewFights.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const reviewFights = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('pull numbers follow chronological order within encounter and difficulty', () => {
	const fights = [
		{ id: 8, encounterID: 100, difficulty: 5, startTime: 8_000 },
		{ id: 3, encounterID: 100, difficulty: 5, startTime: 3_000 },
		{ id: 6, encounterID: 100, difficulty: 4, startTime: 6_000 },
		{ id: 4, encounterID: 200, difficulty: 5, startTime: 4_000 },
	];

	assert.deepEqual(
		[...reviewFights.buildPullNumberByFightID(fights)],
		[
			[3, 1],
			[4, 1],
			[6, 1],
			[8, 2],
		],
	);
});

test('fight ID breaks equal-start-time ties deterministically', () => {
	const fights = [
		{ id: 12, encounterID: 100, difficulty: 5, startTime: 1_000 },
		{ id: 11, encounterID: 100, difficulty: 5, startTime: 1_000 },
	];

	assert.deepEqual(
		[...reviewFights.buildPullNumberByFightID(fights)],
		[[11, 1], [12, 2]],
	);
});

test('new fight detection ignores the initial report load', () => {
	assert.deepEqual(
		reviewFights.findNewReviewFightIDs(null, [{ id: 1 }, { id: 2 }]),
		[],
	);
});

test('new fight detection compares IDs without treating metadata updates as new', () => {
	assert.deepEqual(
		reviewFights.findNewReviewFightIDs(
			[{ id: 2 }, { id: 1 }],
			[{ id: 1, name: 'Updated pull' }, { id: 3 }, { id: 2 }, { id: 3 }],
		),
		[3],
	);
});

const phaseDefinitions = [{
	encounterID: 100,
	phases: [
		{ id: 10, name: 'Opening', isIntermission: false },
		{ id: 11, name: 'Intermission', isIntermission: true },
		{ id: 12, name: 'Finale', isIntermission: false },
		{ id: 13, name: 'Last stand', isIntermission: false },
	],
}];

test('fight progress uses the phase active at the end of a cyclic pull', () => {
	const progress = reviewFights.getReviewFightProgress({
		id: 1,
		encounterID: 100,
		kill: false,
		bossPercentage: 44,
		phaseTransitions: [
			{ id: 10, startTime: 0 },
			{ id: 12, startTime: 10_000 },
			{ id: 10, startTime: 20_000 },
		],
	}, phaseDefinitions);

	assert.deepEqual(progress, { label: '44% P1', color: '#f3cc31' });
});

test('fight progress numbers phases independently from intermissions', () => {
	const progress = reviewFights.getReviewFightProgress({
		id: 1,
		encounterID: 100,
		kill: false,
		bossPercentage: 2.5,
		phaseTransitions: [{ id: 12, startTime: 20_000 }],
	}, phaseDefinitions);

	assert.deepEqual(progress, { label: '2.5% P2', color: '#a8e739' });
});

test('fight progress gives kills and unknown phase metadata stable fallbacks', () => {
	assert.deepEqual(reviewFights.getReviewFightProgress({
		id: 1,
		encounterID: 100,
		kill: true,
		bossPercentage: 0,
		phaseTransitions: [],
	}, phaseDefinitions), { label: 'KILL', color: '#22c55e' });

	assert.deepEqual(reviewFights.getReviewFightProgress({
		id: 2,
		encounterID: 999,
		kill: false,
		bossPercentage: 31.04,
		phaseTransitions: [],
	}, phaseDefinitions), { label: '31%', color: '#e1e74d' });
});

test('fight progress prefers WCL encounter progress over active-boss health', () => {
	const progress = reviewFights.getReviewFightProgress({
		id: 3,
		encounterID: 100,
		kill: false,
		fightPercentage: 75,
		bossPercentage: 12,
		phaseTransitions: [{ id: 12, startTime: 20_000 }],
	}, phaseDefinitions);

	assert.deepEqual(progress, { label: '75% P2', color: '#fb923c' });
});

test('wipe colors interpolate continuously across the proposed health stops', () => {
	assert.equal(reviewFights.getReviewFightWipeColor(100), '#fb7185');
	assert.equal(reviewFights.getReviewFightWipeColor(75), '#fb923c');
	assert.equal(reviewFights.getReviewFightWipeColor(50), '#fbbf24');
	assert.equal(reviewFights.getReviewFightWipeColor(25), '#d9f45a');
	assert.equal(reviewFights.getReviewFightWipeColor(0), '#a3e635');
	assert.notEqual(
		reviewFights.getReviewFightWipeColor(60),
		reviewFights.getReviewFightWipeColor(61),
	);
});
