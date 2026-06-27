import { expect, type Page, test } from "@playwright/test";
import {
    parseResumeStatusResult,
    parseResumeUploadResult,
} from "../../src/shared/schemas";
import { pdfWithPages } from "../fixtures/pdf";

const baseURL = process.env.E2E_BASE_URL;

test.describe("deployed Cloudflare Worker app", () => {
    test.skip(
        !baseURL,
        "Set E2E_BASE_URL to run against a deployed Worker URL.",
    );

    test("uploads a PDF through the real app, preserves it after refresh, and archives it", async ({
        page,
    }) => {
        let cleanupResumeId: string | undefined;

        try {
            await page.goto(baseURL!);
            await expect(
                page.getByRole("navigation", { name: /primary/i }),
            ).toBeVisible();

            const uploadResponsePromise = page.waitForResponse(
                (response) => {
                    const request = response.request();

                    return (
                        request.method() === "POST" &&
                        new URL(response.url()).pathname ===
                            "/api/resumes/analyze"
                    );
                },
                { timeout: 30_000 },
            );

            await page.getByLabel(/choose resume pdf/i).setInputFiles({
                name: "asuka.pdf",
                mimeType: "application/pdf",
                buffer: pdfWithPages(1, "Asuka"),
            });

            const uploadResponse = await uploadResponsePromise.catch(
                () => undefined,
            );

            await expect(page).toHaveURL(/\/resumes\/.+/, {
                timeout: 120_000,
            });
            const routedResumeId = resumeIdFromUrl(page.url());

            if (!routedResumeId) {
                throw new Error("Resume detail URL did not include a resumeId");
            }

            if (uploadResponse) {
                expect(uploadResponse.status()).toBe(202);
                cleanupResumeId = parseResumeUploadResult(
                    await uploadResponse.json(),
                ).resumeId;
            } else {
                cleanupResumeId = routedResumeId;
                const statusResponse = await page.request.get(
                    resumeStatusUrl(cleanupResumeId),
                );

                expect(statusResponse.status()).toBe(200);
                expect(
                    parseResumeStatusResult(await statusResponse.json())
                        .resumeId,
                ).toBe(cleanupResumeId);
            }

            expect(routedResumeId).toBe(cleanupResumeId);
            await expectResumeDetailVisible(page);

            await page.reload();
            await expectResumeDetailVisible(page);

            await page.getByRole("link", { name: /uploaded resumes/i }).click();
            const resumePath = `/resumes/${encodeURIComponent(cleanupResumeId)}`;
            const resumeLink = page.locator(`a[href="${resumePath}"]`);
            const resumeRow = page.locator("tr", { has: resumeLink });

            await expect(resumeRow).toContainText(/Asuka/i);

            await page.reload();
            await expect(resumeRow).toContainText(/Asuka/i);

            await resumeRow.getByRole("button", { name: /archive/i }).click();
            await expect(resumeLink).toHaveCount(0);

            const archivedDetail = await page.request.get(
                resumeDetailUrl(cleanupResumeId),
            );

            expect(archivedDetail.status()).toBe(404);
            cleanupResumeId = undefined;
        } finally {
            const cleanupTargetId =
                cleanupResumeId ?? resumeIdFromUrl(page.url());

            if (cleanupTargetId) {
                await page.request
                    .delete(resumeDetailUrl(cleanupTargetId))
                    .catch(() => {
                        // Best-effort cleanup for deployed e2e runs.
                    });
            }
        }
    });
});

async function expectResumeDetailVisible(page: Page): Promise<void> {
    const main = page.locator("main");

    await expect(main.getByRole("heading", { name: /Asuka/i })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Edu" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Work" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Project" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Skills" })).toBeVisible();
}

function resumeIdFromUrl(value: string): string | undefined {
    const match = new URL(value).pathname.match(/^\/resumes\/([^/]+)$/);

    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function resumeDetailUrl(resumeId: string): string {
    return new URL(
        `/api/resumes/${encodeURIComponent(resumeId)}`,
        baseURL!,
    ).toString();
}

function resumeStatusUrl(resumeId: string): string {
    return new URL(
        `/api/resumes/${encodeURIComponent(resumeId)}/status`,
        baseURL!,
    ).toString();
}
