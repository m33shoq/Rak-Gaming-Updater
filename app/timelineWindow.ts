export type ReviewTimelineViewMode = 'fight' | 'comparison';

export type ReviewTimelineWindowContext = {
	reportCode: string;
	fightID: number;
	reportDetails: reportDetails;
	dataSnapshot: ReviewTimelineWindowDataSnapshot;
	phases: reviewPhaseMarker[];
	fightStartTime: number;
	fightDuration: number;
	cursorPercent: number;
	viewMode: ReviewTimelineViewMode;
	title: string;
};

export type ReviewTimelineWindowAction =
	| { type: 'seek'; timestampSeconds: number }
	| { type: 'seek-pull'; fightID: number; timestampSeconds: number }
	| { type: 'open-fight'; fightID?: number }
	| { type: 'open-death'; deathID: number }
	| { type: 'open-pull-death'; fightID: number; deathID: number }
	| { type: 'view-mode'; viewMode: ReviewTimelineViewMode };

export type ReviewTimelineWindowFightData = {
	fightID: number;
	fightEvents?: fightEvent[];
	fightEventsCachedAt?: number;
	cooldownData?: reviewFightCooldownData;
	cooldownDataCachedAt?: number;
	bossCastData?: reviewFightBossCastData;
	bossCastDataCachedAt?: number;
};

export type ReviewTimelineWindowDataSnapshot = {
	reportCode: string;
	cooldownDataInvalidatedAt?: number;
	bossCastDataInvalidatedAt?: number;
	fights: ReviewTimelineWindowFightData[];
};

export type ReviewTimelineReattachReason =
	| 'timeline-closed'
	| 'main-hidden'
	| 'main-minimized'
	| 'context-unavailable';
