<script setup lang="ts">
import { computed } from 'vue';
import { getRaidMarker } from '@/raidMarkers';

const props = defineProps<{
	marker?: number;
}>();

const raidMarker = computed(() => getRaidMarker(props.marker));
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
