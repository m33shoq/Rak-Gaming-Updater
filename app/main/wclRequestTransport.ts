import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@/events';
import type { WclRequestResult } from '@/wclRequests';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

type WclRequestTransportLogger = {
	info: (...args: any[]) => void;
	warn: (...args: any[]) => void;
};

type WclSocketResponse = {
	error?: unknown;
	success?: unknown;
	authLink?: unknown;
	reports?: unknown;
	reportData?: unknown;
	fightEvents?: unknown;
	catalogVersion?: unknown;
	cooldownGroups?: unknown;
	fightCooldownEvents?: unknown;
	bossCastData?: unknown;
};

type WclRequestOptions<T> = {
	eventName: string;
	payload: Record<string, unknown> | null;
	readData: (response: WclSocketResponse) => T | undefined;
	requestLabel: string;
	timeoutMs?: number;
	requiresReady?: boolean;
	logContext?: Record<string, unknown>;
};

export type WclFightRequest = {
	reportCode: string;
	fightID: number;
	encounterID?: number;
};

export function normalizeWclReportCode(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const reportCode = value.trim();
	return /^[a-zA-Z0-9]{16}$/.test(reportCode) ? reportCode : null;
}

export function normalizeWclFightRequest(
	payload: unknown,
	allowEncounterID = false,
): WclFightRequest | null {
	if (!payload || typeof payload !== 'object') return null;
	const input = payload as Record<string, unknown>;
	const reportCode = normalizeWclReportCode(input.reportCode);
	if (!reportCode || !Number.isSafeInteger(input.fightID) || (input.fightID as number) <= 0) return null;

	const encounterID = input.encounterID;
	if (
		allowEncounterID
		&& encounterID != null
		&& (!Number.isSafeInteger(encounterID) || (encounterID as number) <= 0)
	) return null;

	return {
		reportCode,
		fightID: input.fightID as number,
		...(allowEncounterID && typeof encounterID === 'number' ? { encounterID } : {}),
	};
}

function responseErrorMessage(error: unknown): string | null {
	if (typeof error === 'string' && error.trim()) return error;
	if (error instanceof Error && error.message) return error.message;
	return null;
}

export default class WclRequestTransport {
	constructor(
		private readonly socket: Socket,
		private readonly isWclReady: () => boolean,
		private readonly log: WclRequestTransportLogger,
	) {}

	requestAuthLink(): Promise<WclRequestResult<string>> {
		return this.request({
			eventName: SOCKET_EVENTS.WCL_REQUEST_AUTH_LINK,
			payload: null,
			readData: response => typeof response.authLink === 'string' && response.authLink
				? response.authLink
				: undefined,
			requestLabel: 'WCL authorization link',
			requiresReady: false,
		});
	}

	requestTokenRefresh(refreshToken: string): Promise<WclRequestResult<true>> {
		return this.request({
			eventName: SOCKET_EVENTS.WCL_REQUEST_TOKEN_REFRESH,
			payload: { WCL_REFRESH_TOKEN: refreshToken },
			readData: response => response.success === true ? true : undefined,
			requestLabel: 'WCL token refresh',
			requiresReady: false,
			logContext: {},
		});
	}

	requestReports(endTime?: number): Promise<WclRequestResult<unknown[]>> {
		return this.request({
			eventName: SOCKET_EVENTS.WCL_REQUEST_REPORTS_LIST,
			payload: endTime === undefined ? {} : { endTime },
			readData: response => Array.isArray(response.reports) ? response.reports : undefined,
			requestLabel: 'WCL reports',
			logContext: endTime === undefined ? {} : { endTime },
		});
	}

	requestReportData(reportCode: string): Promise<WclRequestResult<Record<string, unknown>>> {
		return this.request({
			eventName: SOCKET_EVENTS.WCL_REQUEST_REPORT_DATA,
			payload: { reportCode },
			readData: response => (
				response.reportData
				&& typeof response.reportData === 'object'
				&& !Array.isArray(response.reportData)
					? response.reportData as Record<string, unknown>
					: undefined
			),
			requestLabel: 'WCL report details',
			logContext: { reportCode },
		});
	}

	requestFightEvents(
		reportCode: string,
		fightID: number,
		encounterID?: number,
	): Promise<WclRequestResult<fightEvent[]>> {
		return this.request({
			eventName: SOCKET_EVENTS.WCL_REQUEST_FIGHT_EVENTS,
			payload: { reportCode, fightID, ...(encounterID ? { encounterID } : {}) },
			readData: response => Array.isArray(response.fightEvents)
				? response.fightEvents as fightEvent[]
				: undefined,
			requestLabel: 'WCL fight events',
			logContext: { reportCode, fightID },
		});
	}

	requestFightCooldowns(
		reportCode: string,
		fightID: number,
	): Promise<WclRequestResult<reviewFightCooldownData>> {
		return this.request({
			eventName: SOCKET_EVENTS.WCL_REQUEST_FIGHT_COOLDOWNS,
			payload: { reportCode, fightID },
			readData: response => Array.isArray(response.fightCooldownEvents) ? {
				catalogVersion: typeof response.catalogVersion === 'number' ? response.catalogVersion : 0,
				cooldownGroups: Array.isArray(response.cooldownGroups)
					? response.cooldownGroups as reviewCooldownGroup[]
					: [],
				fightCooldownEvents: response.fightCooldownEvents as reviewCooldownEvent[],
			} : undefined,
			requestLabel: 'WCL fight cooldowns',
			logContext: { reportCode, fightID },
		});
	}

	requestFightBossCasts(
		reportCode: string,
		fightID: number,
		encounterID?: number,
	): Promise<WclRequestResult<reviewFightBossCastData>> {
		return this.request({
			eventName: SOCKET_EVENTS.WCL_REQUEST_FIGHT_BOSS_CASTS,
			payload: { reportCode, fightID, ...(encounterID ? { encounterID } : {}) },
			readData: response => {
				const data = response.bossCastData;
				return data
					&& typeof data === 'object'
					&& Array.isArray((data as reviewFightBossCastData).abilities)
					&& Array.isArray((data as reviewFightBossCastData).bossCastEvents)
						? data as reviewFightBossCastData
						: undefined;
			},
			requestLabel: 'WCL fight boss casts',
			timeoutMs: 30_000,
			logContext: { reportCode, fightID },
		});
	}

	private request<T>({
		eventName,
		payload,
		readData,
		requestLabel,
		timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
		requiresReady = true,
		logContext = payload || {},
	}: WclRequestOptions<T>): Promise<WclRequestResult<T>> {
		if (!this.socket.connected) {
			return Promise.resolve({ success: false, error: 'Server is disconnected' });
		}
		if (requiresReady && !this.isWclReady()) {
			return Promise.resolve({ success: false, error: 'WCL connection is not ready' });
		}

		return new Promise(resolve => {
			let settled = false;
			let timeout: ReturnType<typeof setTimeout>;
			const finish = (result: WclRequestResult<T>) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.socket.off(SOCKET_EVENTS.SOCKET_DISCONNECTED, handleDisconnect);
				resolve(result);
			};
			const handleDisconnect = () => {
				finish({ success: false, error: 'Server disconnected during WCL request' });
			};

			timeout = setTimeout(() => {
				this.log.warn(`${requestLabel} request timed out`, logContext);
				finish({ success: false, error: `Timed out while requesting ${requestLabel}` });
			}, timeoutMs);
			this.socket.once(SOCKET_EVENTS.SOCKET_DISCONNECTED, handleDisconnect);

			try {
				this.socket.emit(eventName, payload, (response?: WclSocketResponse) => {
					if (!response || typeof response !== 'object') {
						finish({ success: false, error: `${requestLabel} returned no response` });
						return;
					}
					const responseError = responseErrorMessage(response.error);
					if (responseError) {
						finish({ success: false, error: responseError });
						return;
					}

					const data = readData(response);
					if (data === undefined) {
						finish({ success: false, error: `${requestLabel} returned invalid data` });
						return;
					}
					this.log.info(`Received ${requestLabel}`, logContext);
					finish({ success: true, data });
				});
			} catch (error) {
				finish({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}
}
