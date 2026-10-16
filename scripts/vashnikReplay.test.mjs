import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/renderer/replay/vashnikReplay.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mechanics = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const position = { x: 300, y: 420, mapID: 2608 };
const wave = {
	id: 'wave', type: mechanics.VASHNIK_WAVE_TYPE, start: 6000, end: 21000,
	position, data: { speed: 12, offset: 5, halfWidth: 3 },
};
const replay = { duration: 30000, overlays: [wave] };

test('Vashnik wave fronts follow four fixed axes from a frozen expiry origin', () => {
	assert.deepEqual(mechanics.vashnikWaveFronts(replay, 5999), []);
	assert.deepEqual(mechanics.vashnikWaveFronts(replay, 6000).map(f => [f.position.x, f.position.y]), [
		[305,420],[295,420],[300,425],[300,415],
	]);
	assert.deepEqual(mechanics.vashnikWaveFronts(replay, 7000).map(f => [f.position.x, f.position.y]), [
		[317,420],[283,420],[300,437],[300,403],
	]);
	assert.equal(mechanics.vashnikWaveFronts(replay, 7000)[0].halfWidth, 3);
	assert.deepEqual(mechanics.vashnikWaveFronts(replay, 21000), []);
	// Seeking backward recreates exactly the earlier frame, without animation state.
	assert.deepEqual(mechanics.vashnikWaveFronts(replay, 6000).map(f => f.position.x), [305,295,300,300]);
});

test('Vashnik missing release positions do not manufacture a wave at zero', () => {
	assert.deepEqual(mechanics.vashnikWaveFronts({ ...replay, overlays: [{ ...wave, position: undefined }] }, 7000), []);
});

test('Vashnik totem visibility respects individual summons, logged deaths and rewind', () => {
	const r = { duration: 30000, overlays: [
		{ id: 'a', type: mechanics.VASHNIK_TOTEM_TYPE, start: 2000, end: 7000 },
		{ id: 'b', type: mechanics.VASHNIK_TOTEM_TYPE, start: 2500, end: 8000 },
	] };
	const visible = time => mechanics.activeVashnikOverlays(r, mechanics.VASHNIK_TOTEM_TYPE, time).map(o => o.id);
	assert.deepEqual(visible(1999), []);
	assert.deepEqual(visible(2000), ['a']);
	assert.deepEqual(visible(6999), ['a','b']);
	assert.deepEqual(visible(7000), ['b']);
	assert.deepEqual(visible(8000), []);
	assert.deepEqual(visible(6000), ['a','b']);
});

test('Vashnik countdown uses expected expiry without foretelling a death or truncated pull', () => {
	const aura = { start: 1000, end: 3000, data: { expiresAt: 7000 } };
	assert.equal(mechanics.frothRemainingSeconds(aura, 2000, 3000), 5);
	assert.equal(mechanics.frothRemainingSeconds(aura, 7100, 3000), 0);
});

test('Vashnik reference geometry and bounds ignore malformed and unrelated overlays', () => {
	const r = { overlays: [
		{ type: mechanics.VASHNIK_LINE_TYPE, data: { points: [position, { x: 'bad', y: 1, mapID: 2608 }, null] } },
		{ type: mechanics.VASHNIK_TOTEM_TYPE, start: 1000, position: { ...position, x: 320 } },
		{ type: 'other-mechanic', start: 0, position: { ...position, x: 999 } },
	] };
	assert.deepEqual(mechanics.vashnikReferencePoints(r), [{ timestamp: 0, ...position }]);
	assert.deepEqual(mechanics.vashnikBoundsPoints(r).map(p => p.x), [300,320]);
	assert.equal(mechanics.vashnikPoint({ x: Infinity, y: 1, mapID: 2608 }), undefined);
});
