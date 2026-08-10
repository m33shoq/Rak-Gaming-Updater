import { onScopeDispose } from 'vue';

export function useIpcOn(channel: string, listener: RgIpcRendererListener) {
	const subscriptionID = ipc.on(channel, listener);
	onScopeDispose(() => ipc.off(subscriptionID));
	return subscriptionID;
}
