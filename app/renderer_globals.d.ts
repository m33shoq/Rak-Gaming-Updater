declare type FileData = {
	fileName: string; // Name of the file
	displayName: string; // Display name for the file
	hash: string; // Hash of the file or directory content
	relativePath: string; // Relative path of the file from the root directory
	timestamp: number; // Last modified timestamp in seconds
}

declare type reportSummary = {
	code: string;
	title: string;
	startTime: number;
	endTime: number;
	visibility: string;
	owner: { name: string };
	zone: { name: string };
}

declare type fightDetails = {
	id: number;
	name: string;
	encounterID: number;
	difficulty: number;
	startTime: number;
	endTime: number;
	bossPercentage: number;
	// fightPercentage: number;
	kill: boolean;
	friendlyPlayers: number[];
	friendlySpecs: string[];
	// originalEncounterID: number;
	phaseTransitions: Array<{
		id: number;
		startTime: number;
	}>
}

declare type reportActor = {
	gameID?: number;
	id: number;
	icon?: string;
	name: string;
	petOwner?: number;
	server?: string;
	subType?: string;
	type?: string;
}

declare type reportDetails = {
	code: string;
	title: string;
	startTime: number;
	endTime: number;
	// visibility: string;
	// owner: { name: string };
	// zone: { name: string };
	fights : Array<fightDetails>;
	masterData?: {
		actors?: reportActor[];
	};
	phases: Array<{
		encounterID: number;
		// separatesWipes: boolean;
		phases: Array<{
			id: number;
			name: string;
			isIntermission: boolean;
		}>;
	}>
}

declare type YouTubeVideo = {
	id: string;
	title: string;
	author: string;
	authorID: string;
	startTime: number; // UNIX ms
	duration: number; // time in ms
	checkTime: number; // UNIX ms - time when the video was checked/added to the list
}

declare type ObsSettings = {
	enabled: boolean;
	port: number;
	password: string;
}

declare type ObsStatus = {
	connected: boolean;
	streaming: boolean;
	reconnecting: boolean;
	appRunning: boolean | null;
	websocketEnabled: boolean | null;
	lastError: string | null;
	updatedAt: number;
	serviceName: string | null;
	server: string | null;
}

declare type fightEvent = {
	timestamp: number;
	type: string;
	source?: {
		guid?: number,
		icon?: string,
		id?: number,
		name?: string,
		type?: string
	};
	target?: {
		guid?: number,
		icon?: string,
		id?: number,
		name?: string,
		type?: string
	};
	ability?: {
		abilityIcon?: string,
		guid?: number,
		name?: string,
		type?: number,
	};
	fight?: number;
	pin?: number;
	killerID?: number;
	killingAbility?: {
		abilityIcon?: string,
		guid?: number,
		name?: string,
		type?: number,
	};
}

declare type reviewFightEventsResponse = {
	fightEvents?: fightEvent[];
	error?: string;
}

declare type reviewPhaseMarker = {
	name: string | number;
	percent: number;
}

declare type reviewCooldownGroupID =
	| 'deaths'
	| 'raid_cd'
	| 'personals'
	| 'externals'
	| 'utility'
	| 'movement'
	| 'dps_cd'
	| 'interrupts'
	| 'aoe_cc'
	| 'single_cc';

declare type reviewCooldownGroup = {
	id: reviewCooldownGroupID;
	label: string;
	defaultEnabled: boolean;
}

declare type reviewCooldownEvent = {
	timestamp: number;
	type: string;
	source?: {
		guid?: number;
		icon?: string;
		id?: number;
		name?: string;
		type?: string;
	};
	sourcePet?: {
		guid?: number;
		icon?: string;
		id?: number;
		name?: string;
		type?: string;
	};
	target?: {
		guid?: number;
		icon?: string;
		id?: number;
		name?: string;
		type?: string;
	};
	ability?: {
		abilityIcon?: string;
		guid?: number;
		name?: string;
		type?: number;
	};
	extraAbility?: {
		abilityIcon?: string;
		guid?: number;
		name?: string;
		type?: number;
	};
	targetInstance?: number;
	targetMarker?: number;
	fight?: number;
	cooldown: {
		spellID: number;
		groups: reviewCooldownGroupID[];
		primaryGroup: reviewCooldownGroupID;
		interruptSuccessful?: boolean;
	};
}

declare type reviewFightCooldownData = {
	catalogVersion: number;
	cooldownGroups: reviewCooldownGroup[];
	fightCooldownEvents: reviewCooldownEvent[];
}

declare type reviewFightCooldownResponse = {
	catalogVersion?: number;
	cooldownGroups?: reviewCooldownGroup[];
	fightCooldownEvents?: reviewCooldownEvent[];
	error?: string;
}

declare type reviewBossCastEvent = {
	timestamp: number;
	duration?: number;
	type: string;
	source?: {
		gameID?: number;
		guid?: number;
		icon?: string;
		id?: number;
		name?: string;
		subType?: string;
		type?: string;
	};
	sourceInstance?: number;
	sourceMarker?: number;
	target?: {
		guid?: number;
		icon?: string;
		id?: number;
		name?: string;
		type?: string;
	};
	targetInstance?: number;
	targetMarker?: number;
	ability?: {
		abilityIcon?: string;
		guid?: number;
		name?: string;
		type?: number;
	};
	fight?: number;
	bossCast: {
		spellID: number;
		startTimestamp?: number;
		sourceGameID?: number;
		sourceSubType?: string;
		interrupt?: {
			timestamp: number;
			source?: {
				gameID?: number;
				guid?: number;
				icon?: string;
				id?: number;
				name?: string;
				subType?: string;
				type?: string;
			};
			sourcePet?: {
				gameID?: number;
				guid?: number;
				icon?: string;
				id?: number;
				name?: string;
				subType?: string;
				type?: string;
			};
			ability?: {
				abilityIcon?: string;
				guid?: number;
				name?: string;
				type?: number;
			};
		};
	};
}

declare type reviewBossCastAbility = {
	spellID: number;
	name: string;
	icon: string;
	castCount: number;
	defaultEnabled: boolean;
	sources: Array<{
		gameID?: number;
		name: string;
		subType: string;
	}>;
}

declare type reviewFightBossCastData = {
	fightID: number;
	abilities: reviewBossCastAbility[];
	bossCastEvents: reviewBossCastEvent[];
	interruptsComplete?: boolean;
}

declare type reviewFightBossCastResponse = {
	bossCastData?: reviewFightBossCastData;
	error?: string;
}

declare type RgIpcRendererEvent = Readonly<Record<string, never>>;
declare type RgIpcRendererListener = (event: RgIpcRendererEvent, ...args: any[]) => void;
declare interface RgIpcRenderer {
	invoke(channel: string, ...args: any[]): Promise<any>;
	send(channel: string, ...args: any[]): void;
	on(channel: string, listener: RgIpcRendererListener): string;
	off(subscriptionID: string): void;
}
declare const ipc: RgIpcRenderer;
declare namespace store {
	const set:(key: string, value: any) => Promise<void>;
	const get:(key: string) => Promise<any>;
	const onSync: (key: string, callback: (newValue: any) => void) => void;
}
