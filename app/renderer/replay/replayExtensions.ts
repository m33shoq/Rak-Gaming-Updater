import type { Component } from 'vue';
import CoiledAltarReplayOverlay from '@/renderer/replay/CoiledAltarReplayOverlay.vue';
import { sampleCoiledAltarSpiritPosition } from '@/renderer/replay/coiledAltarMovement';
import type { FightReplayData, ReplayActor, SampledReplayPosition } from '@/replay';

/** Props shared by optional encounter-specific SVG layers. */
export interface ReplayExtensionRendererProps {
	replay: FightReplayData;
	timestamp: number;
	unit: number;
	actorPositions: ReadonlyMap<string, SampledReplayPosition>;
}

interface ReplayExtensionDefinition {
	renderer?: Component;
	sampleActorPosition?: (
		replay: FightReplayData,
		actor: ReplayActor,
		timestamp: number,
	) => SampledReplayPosition | undefined;
}

// Encounter-specific behavior belongs here, not in the base replay component.
const replayExtensions: Readonly<Partial<Record<number, ReplayExtensionDefinition>>> = {
	3429: {
		renderer: CoiledAltarReplayOverlay,
		sampleActorPosition: sampleCoiledAltarSpiritPosition,
	},
};

export function getReplayExtensionRenderer(encounterID: number): Component | undefined {
	return replayExtensions[encounterID]?.renderer;
}

export function sampleReplayExtensionActorPosition(
	replay: FightReplayData,
	actor: ReplayActor,
	timestamp: number,
): SampledReplayPosition | undefined {
	return replayExtensions[replay.encounterID]?.sampleActorPosition?.(replay, actor, timestamp);
}
