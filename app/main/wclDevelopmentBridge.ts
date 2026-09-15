import { randomBytes, timingSafeEqual } from 'node:crypto';
import fsp from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const BRIDGE_VERSION = 1;
const MAX_REQUEST_BYTES = 512 * 1024;
const WCL_QUERY_ROUTE = '/v1/wcl-query';

type BridgeLogger = {
	info: (...args: any[]) => void;
	warn: (...args: any[]) => void;
};

export type DevelopmentWclQueryResult =
	| { success: true; data: unknown }
	| { success: false; error: string };

interface WclDevelopmentBridgeOptions {
	descriptorPath: string;
	requestQuery: (
		query: string,
		variables: Record<string, unknown>,
	) => Promise<DevelopmentWclQueryResult>;
	log: BridgeLogger;
}

interface WclDevelopmentBridgeDescriptor {
	version: typeof BRIDGE_VERSION;
	pid: number;
	port: number;
	token: string;
	startedAt: number;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
	response.writeHead(status, {
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
	});
	response.end(JSON.stringify(payload));
}

function authorized(request: IncomingMessage, token: string): boolean {
	const header = request.headers.authorization;
	if (!header?.startsWith('Bearer ')) return false;
	const supplied = Buffer.from(header.slice('Bearer '.length));
	const expected = Buffer.from(token);
	return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_REQUEST_BYTES) throw new Error('Request body is too large');
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseWclQueryRequest(value: unknown): {
	query: string;
	variables: Record<string, unknown>;
} | null {
	if (!value || typeof value !== 'object') return null;
	const input = value as Record<string, unknown>;
	if (typeof input.query !== 'string' || !input.query.trim()) return null;
	if (Buffer.byteLength(input.query, 'utf8') > 64 * 1024) return null;
	const variables = input.variables == null ? {} : input.variables;
	if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return null;
	if (Buffer.byteLength(JSON.stringify(variables), 'utf8') > 256 * 1024) return null;
	return { query: input.query, variables: variables as Record<string, unknown> };
}

/**
 * Development-only, capability-scoped access to the app's live WCL session.
 * The descriptor contains a random per-process token and is stored beside the
 * app logs. It exposes arbitrary read-only GraphQL queries for local
 * diagnostics. Packaged builds never construct this bridge.
 */
export default class WclDevelopmentBridge {
	private readonly token = randomBytes(32).toString('hex');
	private server: Server | null = null;

	constructor(private readonly options: WclDevelopmentBridgeOptions) {}

	async start(): Promise<void> {
		if (this.server) return;
		const server = createServer((request, response) => {
			void this.handleRequest(request, response);
		});
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				server.off('error', onError);
				resolve();
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen(0, '127.0.0.1');
		});
		server.unref();
		this.server = server;

		try {
			const address = server.address() as AddressInfo;
			const descriptor: WclDevelopmentBridgeDescriptor = {
				version: BRIDGE_VERSION,
				pid: process.pid,
				port: address.port,
				token: this.token,
				startedAt: Date.now(),
			};
			await fsp.mkdir(path.dirname(this.options.descriptorPath), { recursive: true });
			await fsp.writeFile(
				this.options.descriptorPath,
				`${JSON.stringify(descriptor, null, 2)}\n`,
				{ encoding: 'utf8', mode: 0o600 },
			);
			this.options.log.info('Development WCL bridge ready', {
				descriptorPath: this.options.descriptorPath,
				port: address.port,
			});
		} catch (error) {
			this.server = null;
			await new Promise<void>(resolve => server.close(() => resolve()));
			throw error;
		}
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = null;
		if (server) {
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
		try {
			const descriptor = JSON.parse(await fsp.readFile(this.options.descriptorPath, 'utf8')) as Partial<WclDevelopmentBridgeDescriptor>;
			if (descriptor.pid === process.pid && descriptor.token === this.token) {
				await fsp.unlink(this.options.descriptorPath);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				this.options.log.warn('Failed to clean up WCL development bridge descriptor', { error });
			}
		}
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (
			request.method !== 'POST'
			|| request.url !== WCL_QUERY_ROUTE
		) {
			sendJson(response, 404, { success: false, error: 'Not found' });
			return;
		}
		if (!authorized(request, this.token)) {
			sendJson(response, 401, { success: false, error: 'Unauthorized' });
			return;
		}

		try {
			const body = await readJsonBody(request);
			const queryRequest = parseWclQueryRequest(body);
			if (!queryRequest) {
				sendJson(response, 400, { success: false, error: 'Invalid WCL query request' });
				return;
			}
			const result = await this.options.requestQuery(queryRequest.query, queryRequest.variables);
			if (!result.success) {
				sendJson(response, 503, result);
				return;
			}
			sendJson(response, 200, result);
		} catch (error) {
			this.options.log.warn('Development WCL bridge request failed', { error });
			sendJson(response, 500, {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
