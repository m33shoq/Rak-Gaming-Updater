import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/replay.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const replay = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const position = { timestamp: 1000, x: 0, y: 0, mapID: 1, facingDegrees: 90 };

test('position sampling avoids long invented movement', () => {
	assert.equal(replay.sampleReplayPosition([position], 999, 3000), null);
	assert.equal(replay.sampleReplayPosition([position], 4001, 3000), null);
	assert.equal(replay.sampleReplayPosition([
		position,
		{ ...position, timestamp: 2000, x: 10 },
	], 1500, 3000).x, 5);
	assert.equal(replay.sampleReplayPosition([
		position,
		{ ...position, timestamp: 3000, x: 10 },
	], 1500, 3000).x, 0);
});

test('actor activity and current cast use their intended playback windows', () => {
	const actor = { active: [{ start: 100, end: 200 }] };
	assert.equal(replay.isReplayActorActive(actor, 150), true);
	assert.equal(replay.isReplayActorActive(actor, 200), false);

	const casts = [{ actorKey: 'one', start: 100, end: 200 }];
	assert.equal(replay.activeReplayCast(casts, 'one', 199), casts[0]);
	assert.equal(replay.activeReplayCast(casts, 'one', 200), null);
});
