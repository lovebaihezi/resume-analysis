import { expect, test } from "@playwright/test";
import { pdfWithPages } from "../fixtures/pdf";

const baseURL = process.env.E2E_BASE_URL;

test.describe("deployed Cloudflare Worker app", () => {
    test.skip(
        !baseURL,
        "Set E2E_BASE_URL to run against a deployed Worker URL.",
    );

    test("uploads a PDF through the real app and opens the stored resume detail page", async ({
        page,
    }) => {
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
        await page.getByRole("link", { name: /uploaded resumes/i }).click();
        await expect(page.getByRole("table")).toContainText(/Ava/i);
    });
});
