import { ref } from 'vue';
import { IPC_EVENTS } from '@/events';

export function useAppVersion() {
	const appVersionInfo = ref<any>({version: 'unknown', releaseType: 'unknown'});

	ipc.invoke(IPC_EVENTS.APP_GET_VERSION).then((versionInfo) => {
		appVersionInfo.value = versionInfo
	});

	return {
		appVersionInfo,
	};
}
