import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/replay.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const replay = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const coiledMovementSource = readFileSync(
	new URL('../app/renderer/replay/coiledAltarMovement.ts', import.meta.url),
	'utf8',
);
const coiledMovementJs = ts.transpileModule(coiledMovementSource, {
	compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const coiledMovement = await import(
	`data:text/javascript;base64,${Buffer.from(coiledMovementJs).toString('base64')}`
);
const replayMapManifest = JSON.parse(readFileSync(
	new URL('../app/assets/replay-maps/uimap/manifest.json', import.meta.url),
	'utf8',
));
const position = { timestamp: 1000, x: 0, y: 0, mapID: 1 };

test('position sampling avoids long invented movement', () => {
	assert.equal(replay.sampleReplayPosition([position], 999, 3000), null);
	assert.equal(replay.sampleReplayPosition([position], 4001, 3000), null);
	assert.equal(replay.sampleReplayPosition([
		position,
		{ ...position, timestamp: 2000, x: 10 },
	], 1500, 3000).x, 5);
	assert.equal(replay.sampleReplayPosition([
		position,
		{ ...position, timestamp: 2000, x: 10 },
	], 1500, 3000, false).x, 0);
	assert.equal(replay.sampleReplayPosition([
		position,
		{ ...position, timestamp: 3000, x: 10 },
	], 1500, 3000).x, 0);
});

test('facing sampling is causal and expires independently from position', () => {
	const facings = [
		{ timestamp: 1000, facingDegrees: 90 },
		{ timestamp: 2000, facingDegrees: 180 },
	];
	assert.equal(replay.sampleReplayFacing(facings, 999, 3000), null);
	assert.equal(replay.sampleReplayFacing(facings, 1500, 3000).facingDegrees, 90);
	assert.equal(replay.sampleReplayFacing(facings, 1999, 3000).facingDegrees, 90);
	assert.equal(replay.sampleReplayFacing(facings, 2000, 3000).facingDegrees, 180);
	assert.equal(replay.sampleReplayFacing(facings, 5001, 3000), null);
});

test('actor activity and current cast use their intended playback windows', () => {
	const actor = { active: [{ start: 100, end: 200 }] };
	assert.equal(replay.isReplayActorActive(actor, 150), true);
	assert.equal(replay.isReplayActorActive(actor, 200), false);

	const casts = [{ actorKey: 'one', start: 100, end: 200 }];
	assert.equal(replay.activeReplayCast(casts, 'one', 199), casts[0]);
	assert.equal(replay.activeReplayCast(casts, 'one', 200), null);
});

test('players remain identifiable as dead between active intervals', () => {
	const actor = {
		kind: 'player',
		active: [
			{ start: 0, end: 3000 },
			{ start: 5000, end: 10_000 },
		],
	};
	assert.equal(replay.isReplayPlayerDead(actor, 2999, 10_000), false);
	assert.equal(replay.isReplayPlayerDead(actor, 3000, 10_000), true);
	assert.equal(replay.isReplayPlayerDead(actor, 4999, 10_000), true);
	assert.equal(replay.isReplayPlayerDead(actor, 5000, 10_000), false);
	assert.equal(replay.isReplayPlayerDead(actor, 10_000, 10_000), false);
});

test('explicit player death windows retain the corpse through fight end', () => {
	const actor = {
		kind: 'player',
		active: [{ start: 0, end: 3000 }],
		deathWindows: [{ start: 3000 }],
	};
	assert.equal(replay.isReplayPlayerDead(actor, 2999, 10_000), false);
	assert.equal(replay.isReplayPlayerDead(actor, 3000, 10_000), true);
	assert.equal(replay.isReplayPlayerDead(actor, 9999, 10_000), true);
	assert.equal(replay.isReplayPlayerDead(actor, 10_000, 10_000), true);
});

test('pending resurrection is exposed only until acceptance', () => {
	const actor = {
		kind: 'player',
		resurrectionWindows: [{ start: 4000, end: 6000, name: 'Rebirth' }],
	};
	assert.equal(replay.pendingReplayPlayerResurrection(actor, 3999), undefined);
	assert.equal(replay.pendingReplayPlayerResurrection(actor, 4000)?.name, 'Rebirth');
	assert.equal(replay.pendingReplayPlayerResurrection(actor, 5999)?.name, 'Rebirth');
	assert.equal(replay.pendingReplayPlayerResurrection(actor, 6000), undefined);
});

test('Coiled Altar gaze checks use the shortest angular distance', () => {
	const observer = { x: 10, y: 0, facingDegrees: 180 };
	assert.equal(coiledMovement.isFacingReplayPoint(observer, { x: 0, y: 0 }), true);
	assert.equal(coiledMovement.isFacingReplayPoint(observer, { x: 10, y: 10 }), false);
	assert.equal(coiledMovement.isFacingReplayPoint(
		{ x: 0, y: 0, facingDegrees: 359 },
		{ x: 10, y: 0 },
	), true);
});

test('Coiled Altar spirits stop under gaze and resume toward their target', () => {
	const movementStart = coiledMovement.COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS;
	const gazeRelease = movementStart + 1000;
	const predictionEnd = gazeRelease + 1000;
	const positions = coiledMovement.buildCoiledAltarSpiritPrediction({
		start: 0,
		end: predictionEnd,
		spiritPositions: [{ timestamp: 0, x: 0, y: 0, mapID: 1 }],
		targetPositions: [
			{ timestamp: 0, x: 10, y: 0, mapID: 1 },
			{ timestamp: gazeRelease, x: 10, y: 0, mapID: 1 },
		],
		targetFacings: [
			{ timestamp: 0, facingDegrees: 180 },
			{ timestamp: gazeRelease, facingDegrees: 90 },
		],
	});

	assert.equal(positions[0].x, 0);
	assert.ok(Math.abs(
		positions.at(-1).x - coiledMovement.COILED_ALTAR_SPIRIT_SPEED_YARDS_PER_SECOND,
	) < 0.0001);
	assert.equal(positions.at(-1).y, 0);
});

test('Coiled Altar prediction does not backdate a future facing observation', () => {
	const end = coiledMovement.COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS + 500;
	const positions = coiledMovement.buildCoiledAltarSpiritPrediction({
		start: 0,
		end,
		spiritPositions: [{ timestamp: 0, x: 0, y: 0, mapID: 1 }],
		targetPositions: [{ timestamp: end, x: 10, y: 0, mapID: 1 }],
		targetFacings: [{ timestamp: end, facingDegrees: 180 }],
	});

	assert.equal(positions.at(-1).x, 0);
});


test('Coiled Altar spirits honor the configured fixation movement lock', () => {
	const movementStart = coiledMovement.COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS;
	const end = movementStart + 1000;
	const positions = coiledMovement.buildCoiledAltarSpiritPrediction({
		start: 0,
		end,
		spiritPositions: [{ timestamp: 0, x: 0, y: 0, mapID: 1 }],
		targetPositions: Array.from(
			{ length: Math.ceil(end / 1000) + 1 },
			(_, index) => index * 1000,
		).map(timestamp => ({
			timestamp,
			x: 10,
			y: 0,
			mapID: 1,
		})),
		targetFacings: Array.from(
			{ length: Math.ceil(end / 1000) + 1 },
			(_, index) => ({ timestamp: index * 1000, facingDegrees: 90 }),
		),
	});

	assert.equal(positions.some(position => position.timestamp < movementStart && position.x !== 0), false);
	assert.ok(Math.abs(
		positions.at(-1).x - coiledMovement.COILED_ALTAR_SPIRIT_SPEED_YARDS_PER_SECOND,
	) < 0.0001);
});


test('Coiled Altar prediction ignores spirit observations after the spawn anchor', () => {
	const movementStart = coiledMovement.COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS;
	const end = movementStart + 1000;
	const positions = coiledMovement.buildCoiledAltarSpiritPrediction({
		start: 0,
		end,
		spiritPositions: [
			{ timestamp: 0, x: 0, y: 0, mapID: 1 },
			{ timestamp: movementStart + 500, x: 100, y: 100, mapID: 1 },
		],
		targetPositions: Array.from(
			{ length: Math.ceil(end / 500) + 1 },
			(_, index) => ({
				timestamp: index * 500,
				x: 100,
				y: 0,
				mapID: 1,
			}),
		),
		targetFacings: Array.from(
			{ length: Math.ceil(end / 500) + 1 },
			(_, index) => ({ timestamp: index * 500, facingDegrees: 90 }),
		),
	});

	assert.ok(Math.abs(
		positions.at(-1).x - coiledMovement.COILED_ALTAR_SPIRIT_SPEED_YARDS_PER_SECOND,
	) < 0.0001);
	assert.equal(positions.at(-1).y, 0);
});

test('Coiled Altar refixates continue from the previously predicted position', () => {
	const lock = coiledMovement.COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS;
	const firstEnd = lock + 1000;
	const secondEnd = firstEnd + lock + 1000;
	const positionSamples = (start, end, x, y) => Array.from(
		{ length: Math.ceil((end - start) / 500) + 1 },
		(_, index) => ({
			timestamp: start + index * 500,
			x,
			y,
			mapID: 1,
		}),
	);
	const facingSamples = (start, end, facingDegrees) => Array.from(
		{ length: Math.ceil((end - start) / 500) + 1 },
		(_, index) => ({ timestamp: start + index * 500, facingDegrees }),
	);
	const replayData = {
		duration: secondEnd,
		actors: [
			{
				key: 'spirit',
				positions: [
					{ timestamp: 0, x: 0, y: 0, mapID: 1 },
					{ timestamp: firstEnd, x: 50, y: 50, mapID: 1 },
				],
			},
			{
				key: 'first-target',
				positions: positionSamples(0, firstEnd, 100, 0),
				facings: facingSamples(0, firstEnd, 90),
			},
			{
				key: 'second-target',
				positions: positionSamples(firstEnd, secondEnd, 4, 100),
				facings: facingSamples(firstEnd, secondEnd, 0),
			},
		],
		overlays: [
			{
				type: coiledMovement.COILED_ALTAR_FIXATION_OVERLAY_TYPE,
				start: 0,
				end: firstEnd,
				actorKeys: ['spirit', 'first-target'],
			},
			{
				type: coiledMovement.COILED_ALTAR_FIXATION_OVERLAY_TYPE,
				start: firstEnd,
				end: secondEnd,
				actorKeys: ['spirit', 'second-target'],
			},
		],
	};

	const refixate = coiledMovement.sampleCoiledAltarSpiritPosition(replayData, replayData.actors[0], firstEnd);
	const afterSecondMovement = coiledMovement.sampleCoiledAltarSpiritPosition(
		replayData,
		replayData.actors[0],
		secondEnd - 1,
	);
	assert.ok(refixate);
	assert.ok(Math.abs(refixate.x - 4) < 0.0001);
	assert.equal(refixate.y, 0);
	assert.ok(afterSecondMovement);
	assert.ok(Math.abs(afterSecondMovement.x - 4) < 0.0001);
	assert.ok(afterSecondMovement.y > 3.5 && afterSecondMovement.y < 4);
});

test('Coiled Altar coordinate-only events do not refresh stale facing', () => {
	const end = 4000;
	const targetPositions = Array.from(
		{ length: end / 500 + 1 },
		(_, index) => ({ timestamp: index * 500, x: 10, y: 0, mapID: 1 }),
	);
	const positions = coiledMovement.buildCoiledAltarSpiritPrediction({
		start: 0,
		end,
		spiritPositions: [{ timestamp: 0, x: 0, y: 0, mapID: 1 }],
		targetPositions,
		targetFacings: [{ timestamp: 0, facingDegrees: 90 }],
	});

	assert.ok(positions.at(-1).x > 1.1 && positions.at(-1).x < 1.3);
});

test('Coiled Altar repeated unchanged facing observations keep gaze state fresh', () => {
	const end = 4000;
	const targetPositions = Array.from(
		{ length: end / 500 + 1 },
		(_, index) => ({ timestamp: index * 500, x: 10, y: 0, mapID: 1 }),
	);
	const positions = coiledMovement.buildCoiledAltarSpiritPrediction({
		start: 0,
		end,
		spiritPositions: [{ timestamp: 0, x: 0, y: 0, mapID: 1 }],
		targetPositions,
		targetFacings: Array.from(
			{ length: end / 500 + 1 },
			(_, index) => ({ timestamp: index * 500, facingDegrees: 90 }),
		),
	});

	assert.ok(Math.abs(positions.at(-1).x - 7.2) < 0.0001);
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
