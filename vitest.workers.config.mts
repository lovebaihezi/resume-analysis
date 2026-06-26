import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [
        cloudflareTest({
            remoteBindings: false,
            wrangler: {
                configPath: "./wrangler.workers-test.jsonc",
            },
        }),
    ],
    test: {
        include: ["tests/workers/**/*.test.ts"],
    },
});
