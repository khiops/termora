import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vue()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		proxy: {
			"/ws": {
				target: "ws://127.0.0.1:4100",
				ws: true,
			},
			"/api": {
				target: "http://127.0.0.1:4100",
			},
			"/health": {
				target: "http://127.0.0.1:4100",
			},
		},
	},
});
