export interface WarcraftLogsReportLocation {
	reportCode: string;
	fightID?: number;
}

const REPORT_CODE_PATTERN = /^[a-zA-Z0-9]{16}$/;

/**
 * Parse public and regional Warcraft Logs report links without accepting
 * lookalike domains. A fight query is optional; report selection still works
 * for links such as `?fight=last` which do not identify a numeric pull.
 */
export function parseWarcraftLogsReportUrl(input: string): WarcraftLogsReportLocation | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}

	const hostname = url.hostname.toLowerCase();
	if (
		!['http:', 'https:'].includes(url.protocol)
		|| (hostname !== 'warcraftlogs.com' && !hostname.endsWith('.warcraftlogs.com'))
	) return null;

	const segments = url.pathname.split('/').filter(Boolean);
	const reportsIndex = segments.findIndex(segment => segment.toLowerCase() === 'reports');
	const reportCode = reportsIndex >= 0 ? segments[reportsIndex + 1] : undefined;
	if (!reportCode || !REPORT_CODE_PATTERN.test(reportCode)) return null;

	const rawFightID = url.searchParams.get('fight');
	const fightID = rawFightID == null ? undefined : Number(rawFightID);
	return {
		reportCode,
		...(fightID != null && Number.isSafeInteger(fightID) && fightID > 0 ? { fightID } : {}),
	};
}
