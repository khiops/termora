import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		passWithNoTests: true,
		projects: [
			{
				test: {
					name: "shared",
					include: ["packages/shared/**/*.spec.ts"],
					environment: "node",
				},
			},
			{
				test: {
					name: "agent",
					include: ["packages/agent/**/*.spec.ts"],
					environment: "node",
				},
			},
			{
				test: {
					name: "hub",
					include: ["packages/hub/**/*.spec.ts"],
					environment: "node",
				},
			},
			{
				test: {
					name: "web",
					include: ["packages/clients/web/**/*.spec.ts"],
					environment: "happy-dom",
				},
			},
		],
	},
});
