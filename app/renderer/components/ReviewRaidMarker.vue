<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
	marker?: number;
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

const raidMarker = computed(() => props.marker == null
	? undefined
	: RAID_MARKERS[props.marker]);
</script>

<template>
	<img
		v-if="raidMarker"
		:src="raidMarker.icon"
		:alt="`${raidMarker.label} raid marker`"
		class="size-4 shrink-0 object-contain"
		draggable="false"
	/>
</template>
