<script setup lang="ts">
defineProps<{
	label: string;
	change?: () => void;
}>();

const model = defineModel();

</script>

<template>
	<div class="checkbox-container flex items-center mt-5">
		<input type="checkbox"
			class="relative
				cursor-pointer
				appearance-none
				size-5 border-1
				border-gray-100
				rounded-md
				checked:bg-primary
				checked:border-primary"
			@change="change"
			v-model="model"
		/>
		<label class="ml-2.5">
			{{ label }}
		</label>
	</div>
</template>

<style scoped>

.checkbox-container input[type="checkbox"]:checked::after {
	content: '';
	position: absolute;
	left: 7px;
	top: 4px;
	width: 5px;
	height: 10px;
	border: solid white;
	border-width: 0 3px 3px 0;
	transform: rotate(45deg);
}

</style>
