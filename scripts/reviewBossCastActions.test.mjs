import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/reviewBossCastActions.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const actions = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const sampleFight = {
	id: 39,
	encounterID: 3429,
	startTime: 26_696_339,
	endTime: 26_755_788,
};

const eternalNightfall = {
	spellID: 1_286_918,
	name: 'Eternal Nightfall',
};

const dreadmarchSampleFight = {
	id: 3,
	encounterID: 3429,
	startTime: 930_002,
	endTime: 967_824,
};

const dreadmarch = {
	spellID: 1_285_643,
	name: 'Dreadmarch',
};

const soulbinding = {
	spellID: 1_304_032,
	name: 'Soulbinding',
};

test('recognizes Eternal Nightfall on Coiled Altar and exposes interaction copy', () => {
	assert.deepEqual(
		actions.getReviewBossCastActionMetadata(sampleFight, eternalNightfall),
		{
			id: 'coiled-altar-eternal-nightfall-shield-damage',
			label: 'Open Eternal Nightfall shield damage in WCL',
			hint: 'Right-click to open shield damage in WCL',
		},
	);
});

test('builds a Malacrass-only shield-damage URL around the Eternal Nightfall cast', () => {
	const fight = {
		...sampleFight,
		startTime: 26_248_998,
		endTime: 26_878_150,
	};
	const action = actions.getReviewBossCastAction({
		reportCode: 'W9PjRdNtwgAJYq2V',
		fight,
		ability: eternalNightfall,
		occurrenceKind: 'start',
		occurrenceStartTimestampSeconds: null,
		occurrenceTimestampSeconds: 463.882,
	});

	assert.equal(
		action?.url,
		'https://www.warcraftlogs.com/reports/W9PjRdNtwgAJYq2V?fight=39&type=damage-done&pins=2%24Off%24%23244F4B%24expression%24absorbedDamage+%3E+0+AND+target.id+%3D+259854&start=26711880&end=26729130',
	);
	const url = new URL(action.url);
	assert.equal(
		url.searchParams.get('pins'),
		'2$Off$#244F4B$expression$absorbedDamage > 0 AND target.id = 259854',
	);
});

test('uses the known cast outcome when it extends beyond the normal Eternal Nightfall window', () => {
	const action = actions.getReviewBossCastAction({
		reportCode: 'W9PjRdNtwgAJYq2V',
		fight: { ...sampleFight, startTime: 10_000, endTime: 190_000 },
		ability: eternalNightfall,
		occurrenceKind: 'outcome',
		occurrenceStartTimestampSeconds: 100,
		occurrenceTimestampSeconds: 115.002,
	});
	const url = new URL(action.url);
	assert.equal(url.searchParams.get('start'), '109000');
	assert.equal(url.searchParams.get('end'), '126250');
});

test('recovers the Eternal Nightfall start when a terminal cast was not paired', () => {
	const action = actions.getReviewBossCastAction({
		reportCode: 'W9PjRdNtwgAJYq2V',
		fight: { ...sampleFight, startTime: 10_000, endTime: 190_000 },
		ability: eternalNightfall,
		occurrenceKind: 'outcome',
		occurrenceStartTimestampSeconds: null,
		occurrenceTimestampSeconds: 115,
	});
	const url = new URL(action.url);
	assert.equal(url.searchParams.get('start'), '109000');
	assert.equal(url.searchParams.get('end'), '126250');
});

test('builds the Dreadmarch mind-controlled player damage link', () => {
	assert.deepEqual(
		actions.getReviewBossCastActionMetadata(dreadmarchSampleFight, dreadmarch),
		{
			id: 'coiled-altar-dreadmarch-mc-damage',
			label: 'Open Dreadmarch mind-controlled player damage in WCL',
			hint: 'Right-click to open MC player damage in WCL',
		},
	);

	const action = actions.getReviewBossCastAction({
		reportCode: 'CMdj4QAaynKRhxz8',
		fight: dreadmarchSampleFight,
		ability: dreadmarch,
		occurrenceKind: 'outcome',
		occurrenceStartTimestampSeconds: 13.453,
		occurrenceTimestampSeconds: 15.455,
	});
	const url = new URL(action.url);
	assert.equal(url.origin, 'https://www.warcraftlogs.com');
	assert.equal(url.pathname, '/reports/CMdj4QAaynKRhxz8');
	assert.equal(url.searchParams.get('fight'), '3');
	assert.equal(url.searchParams.get('type'), 'damage-done');
	assert.equal(url.searchParams.get('start'), '944457');
	assert.equal(url.searchParams.get('end'), '961707');
	assert.equal(
		url.searchParams.get('pins'),
		'2$Off$#244F4B$expression$absorbedDamage > 0 AND target.type = "Player" AND IN RANGE FROM type = "applydebuff" AND ability.id = 1297445 TO type = "removedebuff" AND ability.id = 1297445 GROUP BY target ON target END',
	);
});

test('estimates the Dreadmarch outcome when given a start-only occurrence', () => {
	const action = actions.getReviewBossCastAction({
		reportCode: 'CMdj4QAaynKRhxz8',
		fight: { ...dreadmarchSampleFight, startTime: 10_000, endTime: 190_000 },
		ability: dreadmarch,
		occurrenceKind: 'start',
		occurrenceStartTimestampSeconds: null,
		occurrenceTimestampSeconds: 75.25,
	});
	const url = new URL(action.url);
	assert.equal(url.searchParams.get('start'), '86250');
	assert.equal(url.searchParams.get('end'), '103500');
});

test('keeps an open-ended Dreadmarch possession window through the end of the pull', () => {
	const action = actions.getReviewBossCastAction({
		reportCode: 'W9PjRdNtwgAJYq2V',
		fight: { ...dreadmarchSampleFight, startTime: 10_000, endTime: 126_038 },
		ability: dreadmarch,
		occurrenceKind: 'outcome',
		occurrenceStartTimestampSeconds: 98,
		occurrenceTimestampSeconds: 100,
	});
	const url = new URL(action.url);
	assert.equal(url.searchParams.get('start'), '109000');
	assert.equal(url.searchParams.get('end'), '126038');
});

test('builds the Soulbinding intermission damage breakdown for Zul\'jan', () => {
	assert.deepEqual(
		actions.getReviewBossCastActionMetadata(dreadmarchSampleFight, soulbinding),
		{
			id: 'coiled-altar-soulbinding-intermission-damage',
			label: 'Open Soulbinding intermission damage in WCL',
			hint: 'Right-click to open intermission damage in WCL',
		},
	);

	const action = actions.getReviewBossCastAction({
		reportCode: 'CMdj4QAaynKRhxz8',
		fight: { ...dreadmarchSampleFight, id: 14 },
		ability: soulbinding,
		occurrenceKind: 'outcome',
		occurrenceStartTimestampSeconds: null,
		occurrenceTimestampSeconds: 20,
	});
	const url = new URL(action.url);
	assert.equal(url.origin, 'https://www.warcraftlogs.com');
	assert.equal(url.pathname, '/reports/CMdj4QAaynKRhxz8');
	assert.equal(url.searchParams.get('fight'), '14');
	assert.equal(url.searchParams.get('type'), 'damage-done');
	assert.equal(url.searchParams.get('phase'), '3');
	assert.equal(
		url.searchParams.get('pins'),
		'2$Off$#244F4B$expression$target.id = 257911',
	);
	assert.equal(url.searchParams.has('start'), false);
	assert.equal(url.searchParams.has('end'), false);
});

test('allows an exact encounter-scoped spell-name fallback for WCL ID variants', () => {
	assert.ok(actions.getReviewBossCastAction({
		reportCode: 'W9PjRdNtwgAJYq2V',
		fight: sampleFight,
		ability: { spellID: 999_999, name: ' Eternal Nightfall ' },
		occurrenceKind: 'start',
		occurrenceStartTimestampSeconds: 10,
		occurrenceTimestampSeconds: 10,
	}));
	assert.equal(actions.getReviewBossCastAction({
		reportCode: 'W9PjRdNtwgAJYq2V',
		fight: { ...sampleFight, encounterID: 9999 },
		ability: { spellID: 999_999, name: 'Eternal Nightfall' },
		occurrenceKind: 'start',
		occurrenceStartTimestampSeconds: 10,
		occurrenceTimestampSeconds: 10,
	}), null);
	assert.equal(
		actions.getReviewBossCastActionMetadata(
			dreadmarchSampleFight,
			{ spellID: 999_998, name: ' Dreadmarch ' },
		)?.id,
		'coiled-altar-dreadmarch-mc-damage',
	);
	assert.equal(
		actions.getReviewBossCastActionMetadata(
			{ ...dreadmarchSampleFight, encounterID: 9999 },
			{ spellID: 999_998, name: 'Dreadmarch' },
		),
		null,
	);
});

test('rejects malformed reports, fights, abilities, and occurrence timestamps', () => {
	assert.equal(
		actions.getReviewBossCastActionMetadata(
			sampleFight,
			{ spellID: 123_456, name: 'Unrelated boss spell' },
		),
		null,
	);
	const validContext = {
		reportCode: 'W9PjRdNtwgAJYq2V',
		fight: sampleFight,
		ability: eternalNightfall,
		occurrenceKind: 'outcome',
		occurrenceStartTimestampSeconds: 0,
		occurrenceTimestampSeconds: 10,
	};
	const contexts = [
		{ ...validContext, reportCode: 'not-a-report' },
		{ ...validContext, fight: { ...sampleFight, id: 0 } },
		{ ...validContext, fight: { ...sampleFight, endTime: sampleFight.startTime } },
		{ ...validContext, ability: { spellID: 0, name: 'Eternal Nightfall' } },
		{ ...validContext, occurrenceKind: 'unknown' },
		{ ...validContext, occurrenceStartTimestampSeconds: -1 },
		{ ...validContext, occurrenceStartTimestampSeconds: 11 },
		{ ...validContext, occurrenceStartTimestampSeconds: Number.NaN },
		{ ...validContext, occurrenceTimestampSeconds: -1 },
		{ ...validContext, occurrenceTimestampSeconds: 60 },
		{ ...validContext, occurrenceTimestampSeconds: Number.NaN },
	];

	for (const context of contexts) {
		assert.equal(actions.getReviewBossCastAction(context), null);
	}
});
