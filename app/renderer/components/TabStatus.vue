<script setup lang="ts">
import TabContent from '@/renderer/components/TabContent.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';

import { useConnectedClientsStore } from '@/renderer/store/ConnectedClientsStore';

const connectedClientsStore = useConnectedClientsStore();

</script>

<template>
	<TabContent>
		<ScrollFrame class="max-h-95/100">
			<template #default>
				<div class="line-item mini">
					<div class="line-item-element font-bold flex flex-row dark:text-white text-black">
						<p class="flex-3">Nickname</p>
						<p class="flex-3">Username / Role</p>
						<p class="flex-3">Last Reload</p>
						<p class="flex-1">Version</p>
					</div>
				</div>

				<div v-for="client in connectedClientsStore.getClients" :key="client.id"
					class="line-item mini dark:bg-dark4 bg-light4">
					<div class="line-item-element select-text flex flex-row">
						<p class="flex-3">{{ client.NICKNAME || client.id }}</p>
						<p class="flex-3">{{ client.username }} {{ client.role ? `- ${client.role}` : '' }}</p>
						<p class="flex-3">{{ client.LAST_RELOAD ? new Date(client.LAST_RELOAD * 1000).toLocaleString() : '?' }}</p>
						<p class="flex-1">{{ client.APP_VERSION || '?' }}</p>
					</div>
				</div>
			</template>
		</ScrollFrame>
	</TabContent>
</template>

<style scoped>

</style>
