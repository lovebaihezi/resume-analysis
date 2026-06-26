import { expect, test } from "@playwright/test";
import { pdfWithPages } from "../fixtures/pdf";

const baseURL = process.env.E2E_BASE_URL;

test.describe("deployed Cloudflare Worker app", () => {
    test.skip(
        !baseURL,
        "Set E2E_BASE_URL to run against a deployed Worker URL.",
    );

    test("uploads a PDF through the real app and preserves it after refresh", async ({
        page,
    }) => {
        let resumeId: string | undefined;

        try {
            await page.goto(baseURL!);
            await expect(
                page.getByRole("navigation", { name: /primary/i }),
            ).toBeVisible();

            await page.getByLabel(/choose resume pdf/i).setInputFiles({
                name: "ava-chen.pdf",
                mimeType: "application/pdf",
                buffer: pdfWithPages(1, "Ava Chen"),
            });

            await expect(page.getByText(/raw resume/i)).toBeVisible({
                timeout: 120_000,
            });
            await expect(page).toHaveURL(/\/resumes\/.+/);
            resumeId = resumeIdFromUrl(page.url());
            await expect(page.getByText(/ava chen/i).first()).toBeVisible();

            await page.reload();
            await expect(page.getByText(/raw resume/i)).toBeVisible({
                timeout: 120_000,
            });
            await expect(page.getByText(/ava chen/i).first()).toBeVisible();

            await page.getByRole("link", { name: /uploaded resumes/i }).click();
            await expect(page.getByRole("table")).toContainText(/Ava/i);

            await page.reload();
            await expect(page.getByRole("table")).toContainText(/Ava/i);
        } finally {
            if (resumeId) {
                await page.request.delete(archiveUrl(resumeId)).catch(() => {
                    // Best-effort cleanup for deployed e2e runs.
                });
            }
        }
    });
});

function resumeIdFromUrl(value: string): string | undefined {
    const match = new URL(value).pathname.match(/^\/resumes\/([^/]+)$/);

    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function archiveUrl(resumeId: string): string {
    return new URL(
        `/api/resumes/${encodeURIComponent(resumeId)}`,
        baseURL!,
    ).toString();
}
