import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/replay.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const replay = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const replayMapManifest = JSON.parse(readFileSync(
	new URL('../app/assets/replay-maps/uimap/manifest.json', import.meta.url),
	'utf8',
));
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

test('Nymrissa map bounds contain WCL replay coordinates', () => {
	const nymrissaMap = replayMapManifest.maps.find(map => map.uiMapID === 2632);
	assert.ok(nymrissaMap);
	assert.equal(nymrissaMap.coordinateTransform, 'flipY');

	// Representative extrema from a real Nymrissa replay. WCL already exposes
	// X as negative world Y; using the raw UiMapAssignment Region Y sign puts
	// this entire fight on the opposite side of the origin.
	for (const sample of [
		{ x: 12015.7, y: 4685.18 },
		{ x: 12157.93, y: 4830.52 },
	]) {
		assert.ok(sample.x >= nymrissaMap.bounds.left);
		assert.ok(sample.x <= nymrissaMap.bounds.right);
		assert.ok(sample.y >= nymrissaMap.bounds.top);
		assert.ok(sample.y <= nymrissaMap.bounds.bottom);
	}
});
