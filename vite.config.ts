import { fileURLToPath } from "node:url";
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import VueDevTools from "vite-plugin-vue-devtools";
import path from 'path';
import { rmSync } from 'node:fs';

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
					sharp: { type: "cjs" },
					tga: { type: "cjs" },
					got: { type: "esm" },
				},
			}),
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
