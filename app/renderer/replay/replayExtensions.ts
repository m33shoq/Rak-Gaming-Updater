import type { Component } from 'vue';
import CoiledAltarReplayOverlay from '@/renderer/replay/CoiledAltarReplayOverlay.vue';
import { sampleCoiledAltarSpiritPosition } from '@/renderer/replay/coiledAltarMovement';
import VashnikReplayOverlay from '@/renderer/replay/VashnikReplayOverlay.vue';
import VashnikReplayLegend from '@/renderer/replay/VashnikReplayLegend.vue';
import { vashnikBoundsPoints, VASHNIK_TOTEM_ID } from '@/renderer/replay/vashnikReplay';
import type { ReplayMapDefinition } from '@/replayMaps';
import type { FightReplayData, ReplayActor, ReplayPosition, SampledReplayPosition } from '@/replay';

/** Props shared by optional encounter-specific SVG layers. */
export interface ReplayExtensionRendererProps {
	replay: FightReplayData;
	timestamp: number;
	unit: number;
	actorPositions: ReadonlyMap<string, SampledReplayPosition>;
	mapID?: number;
	mapDefinition?: ReplayMapDefinition;
	hiddenLayers?: ReadonlySet<string>;
}

export interface ReplayExtensionControl {
	id: string;
	label: string;
}

interface ReplayExtensionDefinition {
	renderer?: Component;
	controls?: readonly ReplayExtensionControl[];
	legend?: Component;
	hiddenActorGameIDs?: readonly number[];
	boundsPoints?: (replay: FightReplayData) => readonly ReplayPosition[];
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
	3455: {
		renderer: VashnikReplayOverlay,
		controls: [
			{ id: 'vashnik-line', label: 'Experimental reference line' },
			{ id: 'vashnik-froth', label: 'Froth & waves' },
			{ id: 'vashnik-totems', label: 'Totems' },
		],
		legend: VashnikReplayLegend,
		hiddenActorGameIDs: [VASHNIK_TOTEM_ID],
		boundsPoints: vashnikBoundsPoints,
	},
};

export function getReplayExtensionControls(encounterID: number): readonly ReplayExtensionControl[] {
	return replayExtensions[encounterID]?.controls || [];
}

export function getReplayExtensionLegend(encounterID: number): Component | undefined {
	return replayExtensions[encounterID]?.legend;
}

/** A custom encounter layer owns these NPC glyphs; avoid drawing them twice. */
export function getReplayExtensionActors(replay: FightReplayData): readonly ReplayActor[] {
	const hidden = replayExtensions[replay.encounterID]?.hiddenActorGameIDs;
	return hidden ? replay.actors.filter(actor => !hidden.includes(actor.gameID ?? -1)) : replay.actors;
}

export function getReplayExtensionBoundsPoints(replay: FightReplayData): readonly ReplayPosition[] {
	return replayExtensions[replay.encounterID]?.boundsPoints?.(replay) || [];
}

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
