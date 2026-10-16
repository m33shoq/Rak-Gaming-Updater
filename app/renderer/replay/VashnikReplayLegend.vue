<script setup lang="ts">
import { computed } from 'vue';
import type { FightReplayData } from '@/replay';
import { vashnikReferencePoints } from '@/renderer/replay/vashnikReplay';

const props = defineProps<{ replay: FightReplayData }>();
const entries = computed(() => [
	{
		key: 'line', label: 'Recommended line',
		description: 'Numbered circles mark five suggested positions, 10 yd apart.',
	},
	{
		key: 'froth', label: 'Plague Froth countdown',
		description: 'The ring and timer show time remaining. Yellow marks the final 2 seconds.',
	},
	{
		key: 'arrows', label: 'Wave directions',
		description: 'Four arrows preview waves traveling along the map axes.',
	},
	{
		key: 'wave', label: 'Traveling wave fronts',
		description: 'Green bars show modeled waves moving outward after the debuff expires.',
	},
	{
		key: 'sources', label: 'Totem source colors',
		description: 'Orange = fire fountain. Purple = shadow fountain.',
	},
	{
		key: 'observed', label: 'Logged totem position',
		description: 'A solid diamond marks a coordinate recorded for that totem in WCL.',
	},
	{
		key: 'inferred', label: 'Position inferred from timing',
		description: 'A dashed diamond shows one plausible location consistent with wave timing.',
	},
	{
		key: 'prior', label: 'Position from spawn distribution',
		description: 'A faded diamond with ? is an approximate location without matching wave timing.',
	},
].filter(entry => entry.key !== 'line' || vashnikReferencePoints(props.replay).length === 5));
</script>

<template>
	<details class="vashnik-legend" open>
		<summary>Vashnik map legend</summary>
		<div class="legend-content">
			<ul class="legend-entries">
				<li v-for="entry in entries" :key="entry.key" class="legend-entry">
					<svg class="legend-sample" viewBox="0 0 48 36" aria-hidden="true" focusable="false">
						<g v-if="entry.key === 'line'" stroke="#7dd3fc" fill="#143544">
							<path d="M4 26L44 10" stroke-dasharray="4 3" />
							<circle cx="12" cy="23" r="7" /><circle cx="36" cy="13" r="7" />
							<g fill="#e0f2fe" stroke="none" font-size="9" font-weight="700" text-anchor="middle">
								<text x="12" y="26">1</text><text x="36" y="16">2</text>
							</g>
						</g>
						<g v-else-if="entry.key === 'froth'">
							<circle cx="17" cy="16" r="11" fill="#14251f" stroke="#6ee7b7" stroke-opacity="0.3" stroke-width="2" />
							<path d="M17 5A11 11 0 0 1 28 16" fill="none" stroke="#fde68a" stroke-width="2" />
							<text x="17" y="20" fill="#6ee7b7" font-size="11" text-anchor="middle">F</text>
							<rect x="23" y="22" width="24" height="12" rx="2" fill="#071510" stroke="#6ee7b7" />
							<text x="35" y="31" fill="#fde68a" font-size="9" font-weight="700" text-anchor="middle">1.5</text>
						</g>
						<g v-else-if="entry.key === 'arrows'" stroke="#6ee7b7" fill="none" stroke-width="1.5">
							<path d="M24 3V33M9 18H39M20 7L24 3L28 7M20 29L24 33L28 29M13 14L9 18L13 22M35 14L39 18L35 22" />
						</g>
						<g v-else-if="entry.key === 'wave'" stroke="#6ee7b7" fill="rgb(110 231 183 / 24%)">
							<rect x="11" y="7" width="6" height="22" rx="2" />
							<rect x="30" y="7" width="6" height="22" rx="2" />
						</g>
						<g v-else-if="entry.key === 'sources'" fill="#10151d" stroke-width="1.5">
							<path d="M13 7L22 18L13 29L4 18Z" stroke="#fb923c" />
							<path d="M35 7L44 18L35 29L26 18Z" stroke="#c4a1ff" />
						</g>
						<g v-else :opacity="entry.key === 'prior' ? 0.5 : 1">
							<path d="M24 5L36 18L24 31L12 18Z" fill="#10151d" stroke="#cbd5e1" stroke-width="1.5"
								:stroke-dasharray="entry.key === 'observed' ? undefined : '3 2'" />
							<text v-if="entry.key === 'prior'" x="24" y="22" fill="#cbd5e1" font-size="13" text-anchor="middle">?</text>
							<path v-else d="M24 11V25M20 14H28M20 22H28" fill="none" stroke="#cbd5e1" stroke-width="1.5" />
						</g>
					</svg>
					<div>
						<strong>{{ entry.label }}</strong>
						<p>{{ entry.description }}</p>
					</div>
				</li>
			</ul>
			<p class="legend-note">
				Totems disappear at their logged death time. Without a recorded death, they remain through their known lifetime.
				The recommended line, wave paths and inferred positions are model estimates.
			</p>
		</div>
	</details>
</template>

<style scoped>
.vashnik-legend {
	flex-shrink: 0;
	border-top: 1px solid rgb(148 163 184 / 20%);
	background: #141e2b;
	color: #cbd5e1;
	font-size: 11px;
	line-height: 1.4;
}

summary {
	cursor: pointer;
	padding: 7px 10px;
	color: #e0f2fe;
	font-weight: 700;
	user-select: none;
}

summary::after {
	float: right;
	color: #94a3b8;
	content: 'Hide';
	font-weight: 400;
}

.vashnik-legend:not([open]) summary::after {
	content: 'Show';
}

summary:focus-visible {
	outline: 2px solid #7dd3fc;
	outline-offset: -2px;
}

.legend-content {
	max-height: min(32vh, 250px);
	overflow-y: auto;
	padding: 2px 10px 9px;
}

.legend-entries {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
	gap: 12px 18px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.legend-entry {
	display: flex;
	min-width: 0;
	align-items: flex-start;
	gap: 9px;
}

.legend-sample {
	display: block;
	width: 48px;
	height: 36px;
	flex: 0 0 48px;
}

strong {
	color: #e2e8f0;
	font-weight: 600;
}

p {
	margin: 2px 0 0;
	color: #a8b6c9;
}

.legend-note {
	margin-top: 10px;
	border-top: 1px solid rgb(148 163 184 / 16%);
	padding-top: 7px;
}
</style>
