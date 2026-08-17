import { ipcMain, type WebContents } from 'electron';
import store, { type StoreSchema } from '@/main/store';

type StoreSyncSubscription = {
	sender: WebContents;
	unsubscribe: () => void;
};

const subscriptions = new Map<string, StoreSyncSubscription>();
const senderSubscriptions = new Map<number, Set<string>>();
const senderCleanupRegistered = new Set<number>();

function getSubscriptionKey(sender: WebContents, subscriptionID: string) {
	return `${sender.id}:${subscriptionID}`;
}

function removeSubscription(subscriptionKey: string) {
	const subscription = subscriptions.get(subscriptionKey);
	if (!subscription) return;
	subscription.unsubscribe();
	subscriptions.delete(subscriptionKey);
	const subscriptionKeys = senderSubscriptions.get(subscription.sender.id);
	subscriptionKeys?.delete(subscriptionKey);
	if (subscriptionKeys?.size === 0) senderSubscriptions.delete(subscription.sender.id);
}

function registerSenderCleanup(sender: WebContents) {
	if (!senderSubscriptions.has(sender.id)) senderSubscriptions.set(sender.id, new Set());
	if (senderCleanupRegistered.has(sender.id)) return;
	senderCleanupRegistered.add(sender.id);
	sender.once('destroyed', () => {
		const subscriptionKeys = [...(senderSubscriptions.get(sender.id) || [])];
		subscriptionKeys.forEach(removeSubscription);
		senderSubscriptions.delete(sender.id);
		senderCleanupRegistered.delete(sender.id);
	});
}

export function registerRendererStoreSync() {
	ipcMain.handle('store-set', async (_event, key, value) => store.set(key, value));
	ipcMain.handle('store-get', async (_event, key) => store.get(key));

	ipcMain.on('store-sync-request', (event, key: unknown, subscriptionID: unknown) => {
		if (typeof key !== 'string' || typeof subscriptionID !== 'string' || !subscriptionID) return;
		const sender = event.sender;
		const subscriptionKey = getSubscriptionKey(sender, subscriptionID);
		removeSubscription(subscriptionKey);
		registerSenderCleanup(sender);
		const unsubscribe = store.onDidChange(key as keyof StoreSchema, (newValue) => {
			if (!sender.isDestroyed()) sender.send('store-sync', subscriptionID, key, newValue);
		});
		subscriptions.set(subscriptionKey, { sender, unsubscribe });
		senderSubscriptions.get(sender.id)?.add(subscriptionKey);
	});

	ipcMain.on('store-sync-cancel', (event, subscriptionID: unknown) => {
		if (typeof subscriptionID !== 'string' || !subscriptionID) return;
		removeSubscription(getSubscriptionKey(event.sender, subscriptionID));
	});
}
