<script setup lang="ts">
defineProps<{
	label: string;
	class?: object;
	change?: () => void;
}>();

const model = defineModel();

</script>

<template>
	<div class="checkbox-container" :class>
		<input type="checkbox" @change="change" v-model="model" />
		<label v-text=label></label>
	</div>
</template>

<style scoped>
.checkbox-container {
	display: flex;
	align-items: center;
	margin-top: 20px;
	user-select: none;
}

.checkbox-container input[type="checkbox"] {
	-webkit-appearance: none;
	-moz-appearance: none;
	appearance: none;
	width: 20px;
	height: 20px;
	background-color: #f0f0f0;
	border: 2px solid #d1d1d1;
	border-radius: 4px;
	cursor: pointer;
	position: relative;
}

.checkbox-container input[type="checkbox"]:checked {
	background-color: #4CAF50;
	border-color: #4CAF50;
}

.checkbox-container input[type="checkbox"]:checked::after {
	content: '';
	position: absolute;
	left: 6px;
	top: 2px;
	width: 5px;
	height: 10px;
	border: solid white;
	border-width: 0 3px 3px 0;
	transform: rotate(45deg);
}

.checkbox-container label {
	margin-left: 10px;
	font-size: 16px;
}
</style>
