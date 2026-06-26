import stylexPlugin from "@stylexjs/rollup-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const stylex = stylexPlugin({
    dev: true,
    fileName: "stylex.css",
    unstable_moduleResolution: {
        rootDir: __dirname,
        type: "commonJS",
    },
});

export default defineConfig({
    plugins: [react(), tailwindcss(), stylex],
    test: {
        browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright(),
        },
        globals: true,
        include: ["tests/browser/**/*.test.{ts,tsx}"],
        setupFiles: ["tests/setup.ts"],
    },
});
