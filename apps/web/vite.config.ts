import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		// bits-ui ships internal .svelte files that must be transformed by Vite in dev SSR
		noExternal: ["bits-ui"],
	},
});
