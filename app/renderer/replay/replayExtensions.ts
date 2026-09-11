import type { Component } from 'vue';
import CoiledAltarReplayOverlay from '@/renderer/replay/CoiledAltarReplayOverlay.vue';
import type { FightReplayData, SampledReplayPosition } from '@/replay';

/** Props shared by optional encounter-specific SVG layers. */
export interface ReplayExtensionRendererProps {
	replay: FightReplayData;
	timestamp: number;
	unit: number;
	actorPositions: ReadonlyMap<string, SampledReplayPosition>;
}

// Encounter-specific renderers belong here, not in the base replay component.
const replayExtensionRenderers: Readonly<Partial<Record<number, Component>>> = {
	3429: CoiledAltarReplayOverlay,
};

export function getReplayExtensionRenderer(encounterID: number): Component | undefined {
	return replayExtensionRenderers[encounterID];
}
