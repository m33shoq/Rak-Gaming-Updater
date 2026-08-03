<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
	target: NonNullable<reviewCooldownEvent['target']>;
	targetMarker?: number;
	targetInstance?: number;
}>();

const RAID_MARKER_ASSET_ROOT = 'https://warcraft.wiki.gg/images';
const RAID_MARKERS: Readonly<Record<number, { label: string; icon: string }>> = {
	1: { label: 'Star', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidStar.png` },
	2: { label: 'Circle', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidCircle.png` },
	3: { label: 'Diamond', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidDiamond.png` },
	4: { label: 'Triangle', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidTriangle.png` },
	5: { label: 'Moon', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidMoon.png` },
	6: { label: 'Square', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidSquare.png` },
	7: { label: 'Cross', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidCross.png` },
	8: { label: 'Skull', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidSkull.png` },
};

const raidMarker = computed(() => props.targetMarker == null
	? undefined
	: RAID_MARKERS[props.targetMarker]);

function getClassTextColor(className?: string) {
	const colors: Record<string, string> = {
		deathknight: 'text-[#C41E3A]',
		demonhunter: 'text-[#A330C9]',
		druid: 'text-[#FF7C0A]',
		evoker: 'text-[#33937F]',
		hunter: 'text-[#AAD372]',
		mage: 'text-[#3FC7EB]',
		monk: 'text-[#00FF98]',
		paladin: 'text-[#F48CBA]',
		priest: 'text-white',
		rogue: 'text-[#FFF468]',
		shaman: 'text-[#0070DD]',
		warlock: 'text-[#8788EE]',
		warrior: 'text-[#C69B6D]',
	};
	return colors[className?.toLowerCase() || ''] || 'text-inherit';
}
</script>

<template>
	<div
		v-if="target.name && target.name.toLowerCase() !== 'environment'"
		class="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-neutral-300"
	>
		<span>Target:</span>
		<img
			v-if="raidMarker"
			:src="raidMarker.icon"
			:alt="`${raidMarker.label} raid marker`"
			class="size-4 shrink-0 object-contain"
			draggable="false"
		/>
		<span :class="getClassTextColor(target.type)">{{ target.name }}</span>
		<span v-if="targetInstance != null && targetInstance > 0" class="text-neutral-400">
			· Spawn #{{ targetInstance }}
		</span>
	</div>
</template>
