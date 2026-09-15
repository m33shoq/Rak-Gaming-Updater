import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/wclReportUrl.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const parser = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('parses regional WCL report links and an optional numeric fight', () => {
	assert.deepEqual(
		parser.parseWarcraftLogsReportUrl(
			'https://ru.warcraftlogs.com/reports/zDgNdVfw1haBMqPm?fight=6&type=damage-done',
		),
		{ reportCode: 'zDgNdVfw1haBMqPm', fightID: 6 },
	);
});

test('accepts a report URL without a numeric fight', () => {
	assert.deepEqual(
		parser.parseWarcraftLogsReportUrl('https://www.warcraftlogs.com/reports/HhJtkGmqPVpaj9nW?fight=last'),
		{ reportCode: 'HhJtkGmqPVpaj9nW' },
	);
});

test('rejects malformed codes, lookalike hosts, and non-web protocols', () => {
	for (const input of [
		'https://warcraftlogs.example/reports/HhJtkGmqPVpaj9nW',
		'https://warcraftlogs.com.example/reports/HhJtkGmqPVpaj9nW',
		'https://warcraftlogs.com/reports/too-short',
		'file://warcraftlogs.com/reports/HhJtkGmqPVpaj9nW',
		'HhJtkGmqPVpaj9nW',
	]) assert.equal(parser.parseWarcraftLogsReportUrl(input), null);
});
