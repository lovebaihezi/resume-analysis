import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { countPdfPages } from "../../src/backend/pdf";
import {
    parseResumeAnalysis,
    parseResumeInfoResult,
    parseResumeStatusResult,
    parseResumeUploadResult,
} from "../../src/shared/schemas";
import type {
    ResumeInfoResult,
    ResumeStatusResult,
    ResumeUploadResult,
} from "../../src/shared/types";

const CV_URL = "https://skyzh.github.io/files/cv.pdf";
const API_ORIGIN = "https://resume-analysis.test";
const STATUS_POLL_INTERVAL_MS = 5_000;
const STATUS_WAIT_TIMEOUT_MS = 120_000;

// Signal-rich but intentionally less deterministic: this uses remote bindings,
// a public PDF, and live model output, so keep deterministic API/DO tests too.
describe("real resume extraction model through Worker API", () => {
    it(
        "extracts structured content from Skyzh's PDF CV with the current Worker upload flow",
        { timeout: 180_000 },
        async () => {
            const testStartedAt = Date.now();
            const downloadStartedAt = Date.now();

            logRealAiTest("test:start", { cvUrl: CV_URL });
            logRealAiTest("pdf:download:start");

            const cvResponse = await fetch(CV_URL);

            logRealAiTest("pdf:download:response", {
                durationMs: elapsed(downloadStartedAt),
                status: cvResponse.status,
            });
            expect(cvResponse.ok).toBe(true);

            const bytes = new Uint8Array(await cvResponse.arrayBuffer());
            const pages = countPdfPages(bytes);

            logRealAiTest("pdf:download:complete", {
                bytes: bytes.byteLength,
                durationMs: elapsed(downloadStartedAt),
                pages,
            });
            expect(pages).toBe(2);

            const upload = await postResume(bytes);

            expect(upload.status).toBe("creating");
            expect(upload.upload.bytes).toBe(bytes.byteLength);

            const detail = await waitForResumeReady(
                upload.resumeId,
                testStartedAt,
            );
            const resume = parseResumeAnalysis(detail.resume);
            const extracted = JSON.stringify(detail.resume).toLowerCase();

            logRealAiTest("test:assertions", {
                eduCount: resume.edu.length,
                name: resume.basic.name,
                projectCount: resume.project.length,
                rawTextChars: resume.rawText.length,
                resumeId: upload.resumeId,
                totalDurationMs: elapsed(testStartedAt),
                workCount: resume.work.length,
            });
            expect(detail.status).toBe("ready");
            expect(resume.rawText.length).toBeGreaterThan(0);
            expect(resume.basic.name).toMatch(/chi\s+zhang/i);
            expect(extracted).toMatch(/carnegie mellon/);
            expect(extracted).toMatch(/shanghai jiao tong/);
            expect(extracted).toMatch(/databricks|neon/);
            expect(extracted).toMatch(/research|query optimization|cmu-db/);
            expect(resume.edu.length).toBeGreaterThan(0);
            expect(resume.work.length + resume.project.length).toBeGreaterThan(
                0,
            );
        },
    );
});

async function postResume(bytes: Uint8Array): Promise<ResumeUploadResult> {
    const startedAt = Date.now();
    logRealAiTest("upload:start", { bytes: bytes.byteLength });

    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    const response = await workerExports.default.fetch(
        new Request(`${API_ORIGIN}/api/resumes/analyze`, {
            body,
            headers: {
                "content-type": "application/pdf",
                "x-file-name": "cv.pdf",
                "x-upload-source": "click",
            },
            method: "POST",
        }),
    );
    const responseText = await response.text();

    logRealAiTest("upload:response", {
        bodyPreview: responseText.slice(0, 240),
        durationMs: elapsed(startedAt),
        status: response.status,
    });
    expect(response.status).toBe(202);

    const upload = parseResumeUploadResult(JSON.parse(responseText));

    logRealAiTest("upload:accepted", {
        resumeId: upload.resumeId,
        status: upload.status,
    });

    return upload;
}

async function getResume(resumeId: string): Promise<ResumeInfoResult> {
    const startedAt = Date.now();
    const response = await workerExports.default.fetch(
        new Request(`${API_ORIGIN}/api/resumes/${resumeId}`),
    );
    const responseText = await response.text();

    logRealAiTest("detail:response", {
        bodyPreview: responseText.slice(0, 240),
        durationMs: elapsed(startedAt),
        resumeId,
        status: response.status,
    });
    expect(response.status).toBe(200);

    return parseResumeInfoResult(JSON.parse(responseText));
}

async function getResumeStatus(resumeId: string): Promise<ResumeStatusResult> {
    const startedAt = Date.now();
    const response = await workerExports.default.fetch(
        new Request(`${API_ORIGIN}/api/resumes/${resumeId}/status`),
    );
    const responseText = await response.text();

    if (response.status !== 200) {
        logRealAiTest("status:response:error", {
            bodyPreview: responseText.slice(0, 240),
            durationMs: elapsed(startedAt),
            resumeId,
            status: response.status,
        });
    }
    expect(response.status).toBe(200);

    return {
        ...parseResumeStatusResult(JSON.parse(responseText)),
        requestDurationMs: elapsed(startedAt),
    } as ResumeStatusResult & { requestDurationMs: number };
}

async function waitForResumeReady(
    resumeId: string,
    testStartedAt: number,
): Promise<ResumeInfoResult> {
    const deadline = Date.now() + STATUS_WAIT_TIMEOUT_MS;
    let lastStatus:
        | (ResumeStatusResult & { requestDurationMs?: number })
        | undefined;
    let pollCount = 0;

    logRealAiTest("status:wait:start", {
        pollIntervalMs: STATUS_POLL_INTERVAL_MS,
        resumeId,
        timeoutMs: STATUS_WAIT_TIMEOUT_MS,
    });

    while (Date.now() < deadline) {
        pollCount += 1;
        lastStatus = await getResumeStatus(resumeId);

        logRealAiTest("status:poll", {
            elapsedMs: elapsed(testStartedAt),
            pollCount,
            requestDurationMs: lastStatus.requestDurationMs,
            resumeId,
            status: lastStatus.status,
            updatedAt: lastStatus.updatedAt,
        });

        if (lastStatus.status === "ready") {
            logRealAiTest("status:ready", {
                elapsedMs: elapsed(testStartedAt),
                pollCount,
                resumeId,
            });
            return getResume(resumeId);
        }

        if (lastStatus.status === "failed") {
            logRealAiTest("status:failed", {
                elapsedMs: elapsed(testStartedAt),
                pollCount,
                resumeId,
            });
            throw new Error(`Resume analysis failed for ${resumeId}`);
        }

        await scheduler.wait(STATUS_POLL_INTERVAL_MS);
    }

    logRealAiTest("status:timeout", {
        elapsedMs: elapsed(testStartedAt),
        lastStatus: lastStatus?.status ?? "unknown",
        pollCount,
        resumeId,
    });
    throw new Error(
        `Timed out waiting for resume ${resumeId}; last status was ${lastStatus?.status ?? "unknown"}`,
    );
}

function logRealAiTest(
    event: string,
    details: Record<string, unknown> = {},
): void {
    console.info("real-ai-test", { event, ...details });
}

function elapsed(startedAt: number): number {
    return Date.now() - startedAt;
}
