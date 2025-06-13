<script setup lang="ts">

interface ButtonProps {
	label: string;
	class?: any;
	click?: () => void;
}

withDefaults(defineProps<ButtonProps>(), {
  class: 'normal'
})
</script>

<template>
	<button :class @click="click">
		{{ label }}
	</button>
</template>

<style scoped>
button {
	font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
	font-weight: 600;
	font-size: 16px;
	background-color: #333;
	border: none;
	padding: 10px 20px;
	border-radius: 10px;;
	user-select: none;

}

button.disabled {
	cursor: not-allowed;
	pointer-events: none;
	opacity: 0.5;
}

button.normal {
	background-color: #007ACC;
	color: #FFFFFF;
	padding: 10px 20px;
	/* border: 1px solid #ffffff; */
	cursor: pointer;
	display: block;
	/* text-align: center; */
}

button.normal:hover {
	background-color: #005EA6;
}

button.normal.small {
	padding: 5px 10px;
	margin: 5px;
}

#add-folder-btn, #add-files-btn {
	line-height: 15px;
	text-align: center;
}

#set-relative-path-btn, #relative-path {
	display: inline-block;
}

button.tab {
	background-color: #f0f0f0;
	border: 1px solid #ccc;
	border-radius: 3px;
	padding: 5px 15px;
	margin: 2px;
	cursor: pointer;
	-webkit-app-region: no-drag;
	transition: background-color 0.3s, border-color 0.3s, transform 0.3s;
}

button.tab:hover {
	background-color: #e0e0e0;
	transform: scale(1.05);
}

button.selected {
	background-color: #007ACC;
	color: #FFFFFF;
	border-color: #005EA6;
	opacity: 1;
}

button.line-item-element {
	width: 240px;
}


</style>
