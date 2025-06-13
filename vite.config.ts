import { fileURLToPath } from "node:url";
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import VueDevTools from "vite-plugin-vue-devtools";
import path from 'path';
import { rmSync } from 'node:fs';
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import tailwindcss from '@tailwindcss/vite';

import pkg from "./package.json";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
	rmSync("dist/", { recursive: true, force: true });

	const __filename = fileURLToPath(import.meta.url);
  	const __dirname = path.dirname(__filename);

	return {
		root: path.resolve(__dirname, 'app'),
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'app'),
			},
		},
		plugins: [
			VueDevTools(),
			vue(),
			electron([
				{
					entry: 'main/main.ts',
					onstart(options) {
						console.log('Starting main process...');
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
								// external: ['ws', 'bufferutil', 'utf-8-validate'],
								output: {
									format: "esm",
									entryFileNames: "[name].mjs",
								},
								external: Object.keys(
									"dependencies" in pkg ? pkg.dependencies : {},
								),
							},
						},
					},
				},
				{
					entry: 'renderer/preload.ts',
					onstart(options) {
						console.log('Starting preload script...');
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
								external: Object.keys(
									"dependencies" in pkg ? pkg.dependencies : {},
								),
								output: {
									format: "esm",
									entryFileNames: "[name].mjs",
								},
							},
						},
					},
				},
			]),
			renderer({
				resolve: {
					archiver: { type: "cjs" },
					regedit: { type: "cjs" },
				},
			}),
			VueI18nPlugin({
				include: path.resolve(__dirname, 'app', 'translations/**'),
			}),
			tailwindcss(),
		],
		// base: path.resolve(__dirname, 'app', 'renderer', ),
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
