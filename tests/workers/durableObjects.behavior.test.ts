import { env, exports as workerExports } from "cloudflare:workers";
import {
    createExecutionContext,
    createMessageBatch,
    getQueueResult,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import type { CloudflareEnv } from "../../src/backend/cf/services";
import type { ResumeAnalysisJob } from "../../src/backend/ports";
import {
    parseResumeInfoResult,
    parseResumeListResult,
    parseResumeStatusResult,
    parseResumeUploadResult,
} from "../../src/shared/schemas";
import type {
    ResumeDocument,
    ResumeMetadata,
    ResumeSummary,
} from "../../src/shared/types";
import { pdfWithPages } from "../fixtures/pdf";
import { sampleResume } from "../fixtures/sampleData";

const createdAt = "2026-06-26T00:00:00.000Z";
const apiOrigin = "https://resume-analysis.test";

function metadata(resumeId: string): ResumeMetadata {
    return {
        createdAt,
        resumeId,
        status: "creating",
        updatedAt: createdAt,
    };
}

function readySummary(resumeId: string): ResumeSummary {
    return {
        ...metadata(resumeId),
        highestEducation: "Master",
        name: "Ava Chen",
        skills: ["React", "Cloudflare Workers", "XState"],
        status: "ready",
        updatedAt: "2026-06-26T00:00:01.000Z",
        workDuration: "2020-01-01 to 2024-03-01",
    };
}

function readyDocument(resumeId: string): ResumeDocument {
    return {
        ...readySummary(resumeId),
        resume: sampleResume,
    };
}

class FixtureAi {
    readonly runCalls: unknown[] = [];

    async run(
        model: string,
        input: unknown,
        options?: unknown,
    ): Promise<unknown> {
        this.runCalls.push({ input, model, options });

        return {
            response: JSON.stringify(sampleResume),
        };
    }
}

describe("Cloudflare Durable Object storage behavior", () => {
    it("uploads through the Worker API and reaches ready through the queue consumer", async () => {
        const ai = new FixtureAi();
        const bytes = pdfWithPages(2, "Ava Chen");
        const uploadResponse = await workerExports.default.fetch(
            new Request(`${apiOrigin}/api/resumes/analyze`, {
                body: bytesToArrayBuffer(bytes),
                headers: {
                    "content-type": "application/pdf",
                    "x-file-name": "ava-chen.pdf",
                    "x-upload-source": "drag",
                },
                method: "POST",
            }),
        );

        expect(uploadResponse.status).toBe(202);
        const upload = parseResumeUploadResult(await uploadResponse.json());
        expect(upload).toMatchObject({
            status: "creating",
            upload: {
                bytes: bytes.byteLength,
                percent: 100,
                source: "drag",
            },
        });

        const creatingStatus = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}/status`,
        );
        expect(creatingStatus.status).toBe(200);
        expect(
            parseResumeStatusResult(await creatingStatus.json()),
        ).toMatchObject({
            resumeId: upload.resumeId,
            status: "creating",
        });

        const notReadyDetail = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}`,
        );
        expect(notReadyDetail.status).toBe(404);

        const emptyList = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes`,
        );
        expect(parseResumeListResult(await emptyList.json()).count).toBe(0);

        const batch = createMessageBatch<ResumeAnalysisJob>(
            "resume-analysis-jobs",
            [
                {
                    attempts: 1,
                    body: { resumeId: upload.resumeId },
                    id: "message-1",
                    timestamp: new Date("2026-06-26T00:00:03.000Z"),
                },
            ],
        );
        const ctx = createExecutionContext();

        if (!worker.queue) {
            throw new Error("Worker queue handler is not exported");
        }

        await worker.queue(batch, workerEnvWithAi(ai), ctx);

        const queueResult = await getQueueResult(batch, ctx);
        expect(queueResult.explicitAcks).toEqual(["message-1"]);
        expect(queueResult.retryMessages).toEqual([]);
        expect(ai.runCalls).toHaveLength(1);

        const readyStatus = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}/status`,
        );
        expect(parseResumeStatusResult(await readyStatus.json())).toMatchObject(
            {
                name: "Ava Chen",
                resumeId: upload.resumeId,
                status: "ready",
            },
        );

        const detailResponse = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}`,
        );
        expect(detailResponse.status).toBe(200);
        const detail = parseResumeInfoResult(await detailResponse.json());
        expect(detail.resume.basic.name).toBe("Ava Chen");
        expect(detail.resume.rawText).toContain("Ava Chen");

        const listResponse = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes`,
        );
        const list = parseResumeListResult(await listResponse.json());
        expect(list).toMatchObject({
            count: 1,
            resumes: [
                expect.objectContaining({
                    name: "Ava Chen",
                    resumeId: upload.resumeId,
                    status: "ready",
                }),
            ],
        });
    });

    it("tracks resume registry creating, ready, and failed states", async () => {
        const registry = env.RESUME_REGISTRY.getByName("registry-transitions");
        const resumeId = "018f2f8c-3a4b-7c01-8d2e-9f0011223344";
        const failedId = "018f2f8c-3a4b-7c01-8d2e-9f0011223345";

        await registry.create(metadata(resumeId));
        expect(await registry.getSummary(resumeId)).toMatchObject({
            resumeId,
            status: "creating",
        });

        await registry.markReady(readySummary(resumeId));
        expect(await registry.getSummary(resumeId)).toMatchObject({
            name: "Ava Chen",
            resumeId,
            status: "ready",
        });
        expect(await registry.listSummaries()).toHaveLength(1);

        await registry.create(metadata(failedId));
        await registry.markFailed(failedId, "2026-06-26T00:00:02.000Z");
        expect(await registry.getSummary(failedId)).toMatchObject({
            resumeId: failedId,
            status: "failed",
        });
        expect(await registry.count()).toBe(1);
    });

    it("lists resume summaries directly from the registry", async () => {
        const registry = env.RESUME_REGISTRY.getByName("registry-list");
        const resumeId = "018f2f8c-3a4b-7c01-8d2e-9f0011223346";

        await registry.create(metadata(resumeId));
        await registry.markReady(readySummary(resumeId));

        expect(await registry.listSummaries()).toEqual([
            expect.objectContaining({
                name: "Ava Chen",
                resumeId,
                status: "ready",
            }),
        ]);
    });

    it("stores and retrieves resume documents by resumeId", async () => {
        const resumeId = "018f2f8c-3a4b-7c01-8d2e-9f0011223347";
        const document = env.RESUME_DOCUMENT.getByName(resumeId);

        await document.init(readyDocument(resumeId));

        expect(await document.get()).toMatchObject({
            resume: {
                basic: {
                    name: "Ava Chen",
                },
            },
            resumeId,
            status: "ready",
        });
        expect(await document.getMetadata()).toMatchObject({
            resumeId,
            status: "ready",
        });
    });

    it("stores pending resume uploads and clears bytes when marked ready", async () => {
        const resumeId = "018f2f8c-3a4b-7c01-8d2e-9f0011223348";
        const document = env.RESUME_DOCUMENT.getByName(resumeId);
        const bytes = new TextEncoder().encode("%PDF-1.7\nAva Chen");

        await document.initUpload({
            ...metadata(resumeId),
            bytes,
            fileName: "ava-chen.pdf",
            source: "drag",
        });

        expect(await document.getPendingUpload()).toMatchObject({
            fileName: "ava-chen.pdf",
            resumeId,
            source: "drag",
            status: "creating",
        });

        await document.markReady(readyDocument(resumeId));

        expect(await document.getPendingUpload()).toBeUndefined();
        expect(await document.get()).toMatchObject({
            resume: {
                basic: {
                    name: "Ava Chen",
                },
            },
            resumeId,
            status: "ready",
        });
    });

});

function workerEnvWithAi(ai: FixtureAi): CloudflareEnv {
    return {
        AI: ai as unknown as Ai,
        JD_INDEX: env.JD_INDEX,
        JD_OBJECT: env.JD_OBJECT,
        RESUME_ANALYSIS_QUEUE: env.RESUME_ANALYSIS_QUEUE,
        RESUME_DOCUMENT: env.RESUME_DOCUMENT,
        RESUME_REGISTRY: env.RESUME_REGISTRY,
    };
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    return buffer;
}
