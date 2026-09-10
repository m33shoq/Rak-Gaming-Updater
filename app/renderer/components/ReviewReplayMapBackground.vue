<script setup lang="ts">
import { computed } from 'vue';
import type { ReplayMapDefinition } from '@/replayMaps';

export interface ReplayMapViewport {
	x: number;
	y: number;
	width: number;
	height: number;
}

const props = defineProps<{
	definition: ReplayMapDefinition;
	viewport: ReplayMapViewport;
}>();

const visibleTiles = computed(() => {
	// Keep a small ring mounted outside the SVG view to avoid flashes while a
	// local asset is decoded during a pan, without decoding the whole raid map.
	const overscan = props.definition.tileWorldSize / 4;
	const left = props.viewport.x - overscan;
	const right = props.viewport.x + props.viewport.width + overscan;
	const top = props.viewport.y - overscan;
	const bottom = props.viewport.y + props.viewport.height + overscan;

	return props.definition.tiles.filter(tile => (
		tile.x < right
		&& tile.x + tile.width > left
		&& tile.y < bottom
		&& tile.y + tile.height > top
	));
});

</script>

<template>
	<g class="replay-map-background" aria-hidden="true">
		<image
			v-for="tile in visibleTiles"
			:key="tile.key"
			:href="tile.imageURL"
			:x="tile.x"
			:y="tile.y"
			:width="tile.width"
			:height="tile.height"
			preserveAspectRatio="none"
		/>
	</g>
</template>

<style scoped>
.replay-map-background {
	pointer-events: none;
	opacity: 0.58;
	filter: saturate(0.72) contrast(1.08) brightness(0.62);
}
</style>
