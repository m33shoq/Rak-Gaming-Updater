import { defineStore } from 'pinia';
import { ref, computed, watch, shallowRef } from 'vue';
import log from 'electron-log/renderer';

type reportSummary = {
	code: string;
	title: string;
	startTime: number;
	endTime: number;
	visibility: string;
	owner: { name: string };
	zone: { name: string };
}

type fightDetails = {
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

type reportDetails = {
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

export const useWCLDataStore = defineStore('wclData', () => {
	const reports = shallowRef<Array<reportSummary>>([]);
	const getReports = computed(() => reports.value);
	function setReports(newReports: Array<reportSummary>) {
		reports.value = newReports;
	}
	async function requestReports() {
		// log.info('Requesting WCL reports');
		const reports = await api.IR_requestWCLReports();
		// log.info('Received WCL reports');
		setReports(reports);
	}

	const selectedReportCode = ref<string | null>(null);
	const getSelectedReport = computed(() => selectedReportCode.value ? reports.value.find(r => r.code === selectedReportCode.value) || null : null);

	watch(selectedReportCode, (newVal, oldVal) => {
		if (newVal !== oldVal) {
			selectedFightID.value = null; // reset selected fight
			savedFightEvents.value = {}; // clear cached fight events
			log.info('Selected report changed:', newVal);
			requestReportData();
		}
	});

	const reportDetails = ref<reportDetails | null>(null);
	const getReportDetails = computed(() => reportDetails.value);
	function setReportDetails(details: reportDetails | null) {
		reportDetails.value = details;
	}

	const selectedFightID = ref<number | null>(null);
	const getSelectedFight = computed(() => getReportDetails.value?.fights?.find(f => f.id === selectedFightID.value) || null);


	watch(selectedFightID, (newVal, oldVal) => {
		if (newVal !== oldVal) {
			requestFightEvents();
		}
	});

	async function requestReportData() {
		const selected = getSelectedReport.value;
		if (!selected) return;
		const reportCode = selected.code;

		const reportData = await api.IR_requestWCLReportData(reportCode);
		// sort fights by start time
		reportData.fights?.sort((a: fightDetails, b: fightDetails) => b.startTime - a.startTime);

		setReportDetails(reportData);
	}

	const savedFightEvents = ref<{ [key: number]: any }>({}); // fightID -> events
	const getFightEvents = computed(() => {
		const fightID = selectedFightID.value;
		if (fightID && savedFightEvents.value[fightID]) {
			return savedFightEvents.value[fightID];
		}
		return [];
	});

	async function requestFightEvents() {
		const selected = getSelectedReport.value;
		const fightID = getSelectedFight.value?.id;
		if (!selected || !fightID || savedFightEvents.value[fightID]) return;

		const reportCode = selected.code;

		const fightEvents = await api.IR_requestWCLFightEvents(reportCode, fightID);

		savedFightEvents.value[fightID] = fightEvents;
	}

	return {
		reports,
		getReports,
		setReports,
		requestReports,

		selectedReportCode,
		getSelectedReport,

		reportDetails,
		getReportDetails,
		requestReportData,

		selectedFightID,
		getSelectedFight,

		savedFightEvents,
		getFightEvents,
		requestFightEvents,
	};
});

