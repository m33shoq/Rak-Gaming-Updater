import { shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import log from 'electron-log/renderer';

const storedRefs: Record<string, any> = {};

interface ElectronStoreRef<T> extends Ref<T> {}

export function getElectronStoreRef<T>(key: string, defaultValue: T): ElectronStoreRef<T> {
  if (key in storedRefs) {
    return storedRefs[key] as Ref<T>;
  }

  const refValue = shallowRef<T>(defaultValue);
  storedRefs[key] = refValue;
  api.store.get(key).then((value: T) => {
    refValue.value = value;
    watch(refValue, (newValue) => {
    //   log.info(`Updating store value for key "${key}":`, newValue);
      api.store.set(key, newValue).catch((error: any) => {
        log.error(`Failed to set store value for key "${key}":`, error);
      });
    });
    api.store.onSync(key, (syncValue: T) => {
      log.info(`Store value for key "${key}" synced:`, syncValue);
      refValue.value = syncValue;
    });
  });
  return refValue;
}
