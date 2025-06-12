<script setup lang="ts">
import ScrollFrame from './ScrollFrame.vue';
import { useConnectedClientsStore } from '@/renderer/store/ConnectedClientsStore';

const connectedClientsStore = useConnectedClientsStore();

</script>

<template>
	<div class="tab-content">
		<div id="status" class="status-header">
			<h2>Clients Status</h2>
		</div>
		<ScrollFrame height="450">
			<template #default>
				<div v-for="client in connectedClientsStore.getClients" :key="client.id"
					class="line-item mini">
					<span class="line-item-element " style="user-select: text;">
						{{ client.id }} - {{ client.username }} - {{ client.role || '' }}
					</span>
				</div>
			</template>
		</ScrollFrame>
	</div>

</template>

<style scoped>

</style>
