<script setup lang="ts">
import TabContent from '@/renderer/components/TabContent.vue';
import ScrollFrame from './ScrollFrame.vue';
import { useConnectedClientsStore } from '@/renderer/store/ConnectedClientsStore';

const connectedClientsStore = useConnectedClientsStore();

</script>

<template>
	<TabContent>
		<div id="status" class="status-header">
			<h2 class="font-bold text-3xl">Clients Status</h2>
		</div>
		<ScrollFrame height="450">
			<template #default>
				<div v-for="client in connectedClientsStore.getClients" :key="client.id"
					class="line-item mini">
					<span class="line-item-element select-text">
						{{ client.id }} - {{ client.username }} - {{ client.role || '' }}
					</span>
				</div>
			</template>
		</ScrollFrame>
	</TabContent>
</template>

<style scoped>

</style>
