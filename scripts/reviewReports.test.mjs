import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/reviewReports.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const reviewReports = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const report = (code, startTime) => ({
	code,
	title: `Report ${code}`,
	startTime,
	endTime: startTime + 1_000,
});

test('session pins are most-recent-first and do not duplicate codes', () => {
	let pins = reviewReports.pinReviewReportCode([], 'older');
	pins = reviewReports.pinReviewReportCode(pins, 'newer');
	pins = reviewReports.pinReviewReportCode(pins, 'older');
	assert.deepEqual(pins, ['older', 'newer']);
});

test('pinned reports precede fetched reports without changing ordinary order', () => {
	const reports = [report('latest', 3_000), report('middle', 2_000), report('oldest', 1_000)];
	assert.deepEqual(
		reviewReports.buildSelectableReviewReports(reports, {}, ['oldest']).map(item => item.code),
		['oldest', 'latest', 'middle'],
	);
});

test('a custom report remains selectable from cached details', () => {
	const reports = [report('latest', 3_000)];
	const custom = report('custom', 500);
	assert.deepEqual(
		reviewReports.buildSelectableReviewReports(reports, { custom }, ['custom']).map(item => item.code),
		['custom', 'latest'],
	);
});

test('a pinned custom report is not duplicated when it later appears in fetched reports', () => {
	const custom = report('custom', 4_000);
	const reports = [custom, report('latest', 3_000)];
	assert.deepEqual(
		reviewReports.buildSelectableReviewReports(reports, { custom }, ['custom']).map(item => item.code),
		['custom', 'latest'],
	);
});
