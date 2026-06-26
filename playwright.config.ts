import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "tests/e2e",
    timeout: 150_000,
    use: {
        baseURL: process.env.E2E_BASE_URL,
        trace: "retain-on-failure",
    },
});
