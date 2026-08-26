<script setup lang="ts">
import ReviewRaidMarker from '@/renderer/components/ReviewRaidMarker.vue';

defineProps<{
	targets: NonNullable<reviewBossCastEvent['bossCast']['targetDebuffs']>;
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
	<div v-if="targets.length" class="mt-1.5 text-[11px] text-neutral-300">
		<div class="font-medium text-violet-300">Debuffs applied to</div>
		<div class="mt-1 flex flex-wrap gap-1">
			<span
				v-for="(targetDebuff, index) in targets"
				:key="`${targetDebuff.target.id ?? targetDebuff.target.guid ?? targetDebuff.target.name}:${index}`"
				class="inline-flex items-center gap-1 border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5"
			>
				<ReviewRaidMarker :marker="targetDebuff.targetMarker" />
				<span :class="getClassTextColor(targetDebuff.target.type)">{{ targetDebuff.target.name || 'Unknown player' }}</span>
			</span>
		</div>
	</div>
</template>
