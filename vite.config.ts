import stylexPlugin from "@stylexjs/rollup-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const stylex = stylexPlugin({
    dev: true,
    fileName: "stylex.css",
    unstable_moduleResolution: {
        rootDir: __dirname,
        type: "commonJS",
    },
});

export default defineConfig({
    build: {
        outDir: "dist",
    },
    plugins: [react(), tailwindcss(), stylex],
});
