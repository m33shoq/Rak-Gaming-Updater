export type ReviewSeekSource =
	| 'fight-selection'
	| 'report-selection'
	| 'video-selection'
	| 'timeline'
	| 'comparison'
	| 'detached-timeline'
	| 'deep-link'
	| 'hotkey';

export type ReviewSeekIntent =
	| {
		kind: 'fight-time';
		source: ReviewSeekSource;
		fightID: number;
		fightTimestampSeconds: number;
		preferredVideoID?: string;
		play: boolean;
		synchronize: boolean;
	}
	| {
		kind: 'video-time';
		source: ReviewSeekSource;
		videoID: string;
		videoTimeSeconds: number;
		play: boolean;
		synchronize: false;
	};

export type ReviewSeekPhase =
	| 'resolving'
	| 'loading'
	| 'seeking'
	| 'verifying'
	| 'completed'
	| 'unverified'
	| 'unavailable'
	| 'failed'
	| 'superseded'
	| 'cancelled';

export type ReviewSeekState = {
	requestID: number;
	intent: ReviewSeekIntent;
	phase: ReviewSeekPhase;
	message?: string;
};

export type ReviewSeekExecutionResult = {
	phase: Extract<ReviewSeekPhase, 'verifying' | 'completed' | 'unverified' | 'unavailable'>;
	message?: string;
};

export type ReviewSeekExecutionContext = {
	requestID: number;
	isCurrent: () => boolean;
	setPhase: (phase: Extract<ReviewSeekPhase, 'resolving' | 'loading' | 'seeking'>) => void;
};

export type ReviewSeekExecutor = (
	intent: ReviewSeekIntent,
	context: ReviewSeekExecutionContext,
) => Promise<ReviewSeekExecutionResult>;

/**
 * Serializes every review seek behind a monotonically increasing request ID.
 *
 * YouTube loads, Vue selection updates and detached-window messages are all
 * asynchronous. They cannot be reliably cancelled, so stale work checks this
 * coordinator before every state-changing step. Submitting a newer intent is
 * sufficient to make every older continuation harmless.
 */
export class ReviewSeekCoordinator {
	private nextRequestID = 0;
	private currentState: ReviewSeekState | null = null;

	constructor(
		private readonly executor: ReviewSeekExecutor,
		private readonly onStateChange?: (state: ReviewSeekState | null) => void,
	) {}

	get state(): ReviewSeekState | null {
		return this.currentState;
	}

	isCurrent(requestID: number): boolean {
		return this.currentState?.requestID === requestID
			&& ['resolving', 'loading', 'seeking', 'verifying'].includes(this.currentState.phase);
	}

	request(intent: ReviewSeekIntent): Promise<ReviewSeekState> {
		const previous = this.currentState;
		if (previous && this.isCurrent(previous.requestID)) {
			this.publish({ ...previous, phase: 'superseded' });
		}

		const requestID = ++this.nextRequestID;
		this.publish({ requestID, intent, phase: 'resolving' });

		return this.execute(requestID, intent);
	}

	cancel(message?: string): void {
		const current = this.currentState;
		if (current && this.isCurrent(current.requestID)) {
			this.publish({ ...current, phase: 'cancelled', message });
		}
		this.nextRequestID++;
	}

	finish(
		requestID: number,
		phase: Extract<ReviewSeekPhase, 'completed' | 'unverified' | 'unavailable' | 'failed'>,
		message?: string,
	): boolean {
		if (!this.isCurrent(requestID)) return false;
		this.publish({ ...this.currentState!, phase, message });
		return true;
	}

	private async execute(requestID: number, intent: ReviewSeekIntent): Promise<ReviewSeekState> {
		try {
			const result = await this.executor(intent, {
				requestID,
				isCurrent: () => this.isCurrent(requestID),
				setPhase: phase => {
					if (this.isCurrent(requestID)) this.publish({ ...this.currentState!, phase });
				},
			});
			if (!this.isCurrent(requestID)) {
				return { requestID, intent, phase: 'superseded' };
			}
			this.publish({ ...this.currentState!, ...result });
			return this.currentState!;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Review seek failed';
			if (!this.isCurrent(requestID)) {
				return { requestID, intent, phase: 'superseded', message };
			}
			this.publish({ ...this.currentState!, phase: 'failed', message });
			return this.currentState!;
		}
	}

	private publish(state: ReviewSeekState | null): void {
		this.currentState = state;
		this.onStateChange?.(state);
	}
}
