<script setup lang="ts">
defineProps<{
	label: string;
	class?: any;
	change?: () => void;
	placeholder?: string;
	type?: string;
}>();

const model = defineModel()

</script>

<template>
	<div class="dropdown-container">
		<label class="dropdown-outer-text" v-text="label"></label>
		<select
			:class
			:placeholder
			:type
			@change="change"
			v-model="model"
		>
			<slot/>
		</select>
	</div>
</template>

<style scoped>

.dropdown-container {
	display: flex;
	flex-direction: column;
	margin-top: 10px;
}
.dropdown-outer-text {
	margin-bottom: 5px;
	font-size: 16px;
}

select {
	width: 100%;
	max-width: 300px;
	padding: 10px;
	border-radius: 5px;
	border: 1px solid #333333;
	background-color: #333333;
	color: #FFFFFF;
	font-size: 16px;
	cursor: pointer;
	white-space: nowrap;
}
select:hover {
	background-color: #444444;
	border-color: #555555;
	color: #FFFFFF;
}

select:focus {
	outline: none;
	border-color: #888888;
	box-shadow: 0 0 5px rgba(136, 136, 136, 0.5);
}

select option {
	background-color: #333333;
	color: #FFFFFF;
}

select option:hover {
	background-color: #444444;
}

</style>
