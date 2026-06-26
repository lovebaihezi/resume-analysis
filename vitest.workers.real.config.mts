import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [
        cloudflareTest({
            remoteBindings: true,
            wrangler: {
                configPath: "./wrangler.jsonc",
            },
        }),
    ],
    test: {
        include: ["tests/real-ai/**/*.test.ts"],
    },
});
