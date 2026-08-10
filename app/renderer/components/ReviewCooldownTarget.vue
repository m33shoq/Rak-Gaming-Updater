<script setup lang="ts">
import ReviewRaidMarker from '@/renderer/components/ReviewRaidMarker.vue';

const props = defineProps<{
	target: NonNullable<reviewCooldownEvent['target']>;
	targetMarker?: number;
	targetInstance?: number;
}>();

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
		<ReviewRaidMarker :marker="targetMarker" />
		<span :class="getClassTextColor(target.type)">{{ target.name }}</span>
		<span v-if="targetInstance != null && targetInstance > 0" class="text-neutral-400">
			· Spawn #{{ targetInstance }}
		</span>
	</div>
</template>
