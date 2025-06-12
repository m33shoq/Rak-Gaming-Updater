import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import VueDevTools from "vite-plugin-vue-devtools";
import path from 'path';
import { rmSync } from 'node:fs';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
	rmSync("dist/", { recursive: true, force: true });
	return {
		root: path.resolve(__dirname, 'app'),
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'app'),
			},
		},
		plugins: [
			// VueDevTools(),
			vue(),
			electron([
				{
					entry: 'src/main.ts',
					onstart(options) {
						options.startup();
					},
					vite: {
						resolve: {
							alias: {
								'@': path.resolve(__dirname, 'app'),
							},
						},
						build: {
							sourcemap: true,
							minify: false,
							outDir: path.resolve(__dirname, 'dist'),
							target: 'esnext',
							rollupOptions: {
								external: ['ws', 'bufferutil', 'utf-8-validate'],
							},
						},
					},
				},
				{
					entry: 'src/preload.ts',
					onstart(options) {
						options.reload();
					},
					vite: {
						resolve: {
							alias: {
								'@': path.resolve(__dirname, 'app'),
							},
						},
						build: {
							sourcemap: true,
							minify: false,
							outDir: path.resolve(__dirname, 'dist'),
							target: 'esnext',
							rollupOptions: {
								external: ['ws', 'bufferutil', 'utf-8-validate'],
							},
						},
					},
				},
			]),
			renderer(),
		],
		base: './',
		server: {
			hmr: true,
		},
		build: {
			outDir: path.resolve(__dirname, 'dist'),
			target: 'esnext',
			sourcemap: true,
			minify: false,
		},
	};
});
