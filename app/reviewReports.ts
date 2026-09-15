export type ReviewReportListItem = Pick<reportSummary, 'code' | 'title' | 'startTime' | 'endTime'>;

export function pinReviewReportCode(
	pinnedReportCodes: readonly string[],
	reportCode: string,
): string[] {
	return [reportCode, ...pinnedReportCodes.filter(code => code !== reportCode)];
}

export function buildSelectableReviewReports(
	reports: readonly ReviewReportListItem[],
	reportDetailsByCode: Readonly<Record<string, ReviewReportListItem>>,
	pinnedReportCodes: readonly string[],
): ReviewReportListItem[] {
	const reportsByCode = new Map(reports.map(report => [report.code, report]));
	const includedCodes = new Set<string>();
	const selectableReports: ReviewReportListItem[] = [];

	for (const reportCode of pinnedReportCodes) {
		const report = reportsByCode.get(reportCode) || reportDetailsByCode[reportCode];
		if (!report || includedCodes.has(reportCode)) continue;
		selectableReports.push(report);
		includedCodes.add(reportCode);
	}

	for (const report of reports) {
		if (includedCodes.has(report.code)) continue;
		selectableReports.push(report);
		includedCodes.add(report.code);
	}

	return selectableReports;
}
