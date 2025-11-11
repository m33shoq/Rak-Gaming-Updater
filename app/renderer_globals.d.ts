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
	// difficulty: number;
	startTime: number;
	endTime: number;
	bossPercentage: number;
	// fightPercentage: number;
	kill: boolean;
	// originalEncounterID: number;
	phaseTransitions: Array<{
		id: number;
		startTime: number;
	}>
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

declare type fightEvent = {
	timestamp: number;
	type: string;
	source: {
		guid: number,
		icon: string,
		id: number,
		name: string,
		type: string
	};
	target: {
		guid: number,
		icon: string,
		id: number,
		name: string,
		type: string
	};
	ability: {
		abilityIcon: string,
		guid: number,
		name: string,
		type: number,
	};
	fight: number;
	pin: number;
	killerID?: number;
	killingAbility?: {
		abilityIcon: string,
		guid: number,
		name: string,
		type: number,
	};
}

declare const ipc: typeof Electron.ipcRenderer;
declare namespace store {
	const set:(key: string, value: any) => Promise<void>;
	const get:(key: string) => Promise<any>;
	const onSync: (key: string, callback: (key, newValue) => void) => void;
}


