import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';
import { ref } from 'vue';

export function useWoWPath() {
	const wowPath = ref<string>('');

	ipc.invoke(IPC_EVENTS.UPDATER_GET_WOW_PATH).then((path: string) => {
		wowPath.value = path || '';
	});

	const selectPath = async () => {
		const res = await ipc.invoke(IPC_EVENTS.UPDATER_SELECT_WOW_PATH);
		if (res) {
			log.info('Selected WoW path:', res);
			await store.set('updatePath', res);
		} else {
			log.info('No WoW path selected, resetting to null');
			await store.set('updatePath', null);
		}
		wowPath.value = await ipc.invoke(IPC_EVENTS.UPDATER_GET_WOW_PATH);
	}

	return {
		wowPath,
		selectPath,
	};
}
