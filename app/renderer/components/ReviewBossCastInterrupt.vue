<script setup lang="ts">
defineProps<{
	interrupt: NonNullable<reviewBossCastEvent['bossCast']['interrupt']>;
	timeLabel?: string;
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

function getSpellIconURL(icon?: string) {
	if (!icon) return '';
	return /^https?:\/\//i.test(icon)
		? icon
		: `https://wow.zamimg.com/images/wow/icons/large/${icon.toLowerCase()}`;
}
</script>

<template>
	<div class="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-neutral-300">
		<img v-if="interrupt.ability?.abilityIcon" :src="getSpellIconURL(interrupt.ability.abilityIcon)" alt="" class="size-4 shrink-0 rounded-none border border-emerald-500/55 bg-black" draggable="false" />
		<span class="font-medium text-emerald-300">Interrupted</span>
		<span>by</span>
		<span :class="getClassTextColor(interrupt.source?.type)">{{ interrupt.source?.name || 'Unknown player' }}</span>
		<span v-if="interrupt.sourcePet?.name" class="text-neutral-400">via {{ interrupt.sourcePet.name }}</span>
		<span>with {{ interrupt.ability?.name || 'an interrupt' }}</span>
		<span v-if="timeLabel" class="tabular-nums text-neutral-400">at {{ timeLabel }}</span>
	</div>
</template>
