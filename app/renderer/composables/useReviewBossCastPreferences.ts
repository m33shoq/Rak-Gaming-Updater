import log from 'electron-log/renderer';
import { ref } from 'vue';

const VISIBILITY_OVERRIDES_STORE_KEY = 'reviewBossCastVisibilityOverrides';
const DISPLAY_MODE_STORE_KEY = 'reviewBossCastDisplayMode';

type BossCastVisibilityOverrides = Record<string, Record<string, boolean>>;
type BossCastDisplayMode = 'full' | 'collapsed';

function getPreferenceScope(encounterID: number, difficulty: number): string {
	return `${encounterID}:${difficulty}`;
}

function parseVisibilityOverrides(value: unknown): BossCastVisibilityOverrides {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const parsed: BossCastVisibilityOverrides = {};
	Object.entries(value).forEach(([scope, overrides]) => {
		if (!scope || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return;
		const scopeOverrides: Record<string, boolean> = {};
		Object.entries(overrides).forEach(([spellID, enabled]) => {
			if (/^\d+$/.test(spellID) && typeof enabled === 'boolean') {
				scopeOverrides[spellID] = enabled;
			}
		});
		parsed[scope] = scopeOverrides;
	});
	return parsed;
}

export function useReviewBossCastPreferences() {
	const visibilityOverrides = ref<BossCastVisibilityOverrides>({});
	const displayMode = ref<BossCastDisplayMode>('collapsed');
	const preferencesLoaded = ref(false);
	let preferencesPromise: Promise<void> | null = null;

	function getPersistableVisibilityOverrides(): BossCastVisibilityOverrides {
		// Values stored in a normal ref are deeply wrapped by Vue. Electron IPC cannot
		// structured-clone those proxies, so rebuild a plain object before crossing it.
		return parseVisibilityOverrides(visibilityOverrides.value);
	}

	function ensurePreferencesLoaded(): Promise<void> {
		if (preferencesLoaded.value) return Promise.resolve();
		if (preferencesPromise) return preferencesPromise;
		preferencesPromise = (async () => {
			try {
				const [storedOverrides, storedDisplayMode] = await Promise.all([
					store.get(VISIBILITY_OVERRIDES_STORE_KEY),
					store.get(DISPLAY_MODE_STORE_KEY),
				]);
				visibilityOverrides.value = parseVisibilityOverrides(storedOverrides);
				displayMode.value = storedDisplayMode === 'full' ? 'full' : 'collapsed';
			} catch (error) {
				log.error('Failed to load boss cast visibility preferences', error);
				visibilityOverrides.value = {};
				displayMode.value = 'collapsed';
			} finally {
				preferencesLoaded.value = true;
				preferencesPromise = null;
			}
		})();
		return preferencesPromise;
	}

	async function reloadPreferences(): Promise<void> {
		if (preferencesPromise) await preferencesPromise;
		preferencesLoaded.value = false;
		preferencesPromise = null;
		await ensurePreferencesLoaded();
	}

	async function setDisplayMode(mode: BossCastDisplayMode): Promise<void> {
		await ensurePreferencesLoaded();
		displayMode.value = mode;
		try {
			await store.set(DISPLAY_MODE_STORE_KEY, mode);
		} catch (error) {
			log.error('Failed to persist boss cast display mode', error);
		}
	}

	function isAbilityEnabled(
		encounterID: number,
		difficulty: number,
		ability: reviewBossCastAbility,
	): boolean {
		const scope = getPreferenceScope(encounterID, difficulty);
		const override = visibilityOverrides.value[scope]?.[String(ability.spellID)];
		return typeof override === 'boolean' ? override : ability.defaultEnabled;
	}

	async function setAbilityEnabled(
		encounterID: number,
		difficulty: number,
		spellID: number,
		enabled: boolean,
	): Promise<void> {
		await ensurePreferencesLoaded();
		const scope = getPreferenceScope(encounterID, difficulty);
		visibilityOverrides.value = {
			...visibilityOverrides.value,
			[scope]: {
				...visibilityOverrides.value[scope],
				[String(spellID)]: enabled,
			},
		};
		try {
			await store.set(VISIBILITY_OVERRIDES_STORE_KEY, getPersistableVisibilityOverrides());
		} catch (error) {
			log.error('Failed to persist boss cast visibility preferences', error);
		}
	}

	async function resetAbilityPreferences(
		encounterID: number,
		difficulty: number,
	): Promise<void> {
		await ensurePreferencesLoaded();
		const scope = getPreferenceScope(encounterID, difficulty);
		visibilityOverrides.value = Object.fromEntries(
			Object.entries(visibilityOverrides.value).filter(([key]) => key !== scope),
		);
		try {
			await store.set(VISIBILITY_OVERRIDES_STORE_KEY, getPersistableVisibilityOverrides());
		} catch (error) {
			log.error('Failed to reset boss cast visibility preferences', error);
		}
	}

	return {
		displayMode,
		ensurePreferencesLoaded,
		isAbilityEnabled,
		preferencesLoaded,
		reloadPreferences,
		resetAbilityPreferences,
		setAbilityEnabled,
		setDisplayMode,
		visibilityOverrides,
	};
}
