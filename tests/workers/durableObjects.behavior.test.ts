import { env, exports as workerExports } from "cloudflare:workers";
import {
    createExecutionContext,
    createMessageBatch,
    getQueueResult,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import {
    createCloudflareServices,
    type CloudflareEnv,
} from "../../src/backend/cf/services";
import type { ResumeAnalysisJob } from "../../src/backend/ports";
import type { ResumeDocument } from "../../src/shared/types";
import {
    parseResumeInfoResult,
    parseResumeListResult,
    parseResumeStatusResult,
    parseResumeUploadResult,
} from "../../src/shared/schemas";
import { resumeAnalysisToFieldTags } from "../../src/shared/resumeStream";
import { pdfWithPages } from "../fixtures/pdf";
import { sampleJobDescription, sampleResume } from "../fixtures/sampleData";

const apiOrigin = "https://resume-analysis.test";
const sampleMatchPayload = {
    dimensions: [
        {
            dimension: "edu",
            label: "Edu",
            percentage: 80,
            rationale: "Master degree aligns with the role baseline.",
            score: 4,
        },
        {
            dimension: "project",
            label: "Project",
            percentage: 80,
            rationale: "Resume analyzer project is directly relevant.",
            score: 4,
        },
        {
            dimension: "work",
            label: "Work",
            percentage: 90,
            rationale: "Senior frontend work maps to the job scope.",
            score: 4.5,
        },
        {
            dimension: "skill",
            label: "Skill",
            percentage: 100,
            rationale: "React, XState, and Workers are present.",
            score: 5,
        },
        {
            dimension: "overall",
            label: "Overall",
            percentage: 90,
            rationale: "Strong frontend and edge platform fit.",
            score: 4.5,
        },
    ],
    intro: {
        advantages: "Strong React and Workers delivery evidence.",
        disadvantages: "Accessibility impact is lighter than requested.",
    },
};

class FixtureAi {
    readonly gatewayRequests: unknown[] = [];

    async run(
        _model: string,
        _input: unknown,
        _options?: unknown,
    ): Promise<unknown> {
        return {
            response: JSON.stringify(sampleJobDescription),
        };
    }

    gateway(_gatewayId: string): {
        run: (request: unknown, options?: unknown) => Promise<Response>;
    } {
        return {
            run: async (request) => {
                this.gatewayRequests.push(request);

                if (gatewayEndpoint(request).includes(":generateContent")) {
                    const body = JSON.stringify(request);
                    const payload = body.includes("Match this resume")
                        ? sampleMatchPayload
                        : sampleJobDescription;

                    return geminiResponse(JSON.stringify(payload));
                }

                return geminiResponse(
                    resumeAnalysisToFieldTags(sampleResume).join(""),
                );
            },
        };
    }

    async toMarkdown(file: { name: string }): Promise<unknown> {
        return {
            data: "Asuka resume converted to markdown",
            format: "markdown",
            id: "converted-asuka",
            mimeType: "application/pdf",
            name: file.name,
            tokens: 8,
        };
    }
}

function gatewayEndpoint(request: unknown): string {
    if (!request || typeof request !== "object") {
        return "";
    }

    const endpoint = (request as { endpoint?: unknown }).endpoint;

    return typeof endpoint === "string" ? endpoint : "";
}

function geminiResponse(text: string): Response {
    return Response.json({
        candidates: [
            {
                content: {
                    parts: [{ text }],
                    role: "model",
                },
                finishReason: "STOP",
            },
        ],
    });
}

describe("Cloudflare Durable Object storage behavior", () => {
    it("uses Gemini 3.5 Flash for JD analysis and Markdown Match", async () => {
        const ai = new FixtureAi();
        const services = createCloudflareServices(workerEnvWithAi(ai));
        const jd = await services.ai.analyzeJobDescription(
            "Senior frontend engineer role requiring React, XState, Cloudflare Workers, and accessibility experience.",
        );
        const resume: ResumeDocument = {
            createdAt: "2026-06-26T00:00:00.000Z",
            resume: sampleResume,
            resumeId: "resume-1",
            status: "ready",
            updatedAt: "2026-06-26T00:00:00.000Z",
        };

        const match = await services.ai.matchResumeToJobDescription(jd, resume);

        expect(jd.requiredSkills).toContain("React");
        expect(
            match.dimensions.map((dimension) => dimension.dimension),
        ).toEqual(["edu", "project", "work", "skill", "overall"]);
        expect(ai.gatewayRequests.map(gatewayEndpoint)).toEqual([
            "v1beta/models/gemini-3.5-flash:generateContent",
            "v1beta/models/gemini-3.5-flash:generateContent",
        ]);
    });

    it("uploads through the Worker API and reaches ready through the queue consumer", async () => {
        const ai = new FixtureAi();
        const bytes = pdfWithPages(2, "Asuka");
        const uploadResponse = await workerExports.default.fetch(
            new Request(`${apiOrigin}/api/resumes/analyze`, {
                body: bytesToArrayBuffer(bytes),
                headers: {
                    "content-type": "application/pdf",
                    "x-file-name": "asuka.pdf",
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

        const readyStatus = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}/status`,
        );
        expect(parseResumeStatusResult(await readyStatus.json())).toMatchObject(
            {
                name: "Asuka",
                resumeId: upload.resumeId,
                status: "ready",
            },
        );

        const detailResponse = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}`,
        );
        expect(detailResponse.status).toBe(200);
        const detail = parseResumeInfoResult(await detailResponse.json());
        expect(detail.resume.basic.name).toBe("Asuka");
        expect(detail.resume.rawText).toContain("Asuka");

        const listResponse = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes`,
        );
        const list = parseResumeListResult(await listResponse.json());
        expect(list).toMatchObject({
            count: 1,
            resumes: [
                expect.objectContaining({
                    name: "Asuka",
                    resumeId: upload.resumeId,
                    status: "ready",
                }),
            ],
        });

        const archiveResponse = await workerExports.default.fetch(
            new Request(`${apiOrigin}/api/resumes/${upload.resumeId}`, {
                method: "DELETE",
            }),
        );
        expect(archiveResponse.status).toBe(204);

        const archivedStatus = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}/status`,
        );
        expect(
            parseResumeStatusResult(await archivedStatus.json()),
        ).toMatchObject({
            archivedAt: expect.any(String),
            name: "Asuka",
            resumeId: upload.resumeId,
            status: "archived",
        });

        const archivedDetail = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes/${upload.resumeId}`,
        );
        expect(archivedDetail.status).toBe(404);

        const archivedListResponse = await workerExports.default.fetch(
            `${apiOrigin}/api/resumes`,
        );
        expect(
            parseResumeListResult(await archivedListResponse.json()).count,
        ).toBe(0);
    });
});

function workerEnvWithAi(ai: FixtureAi): CloudflareEnv {
    return {
        AI: ai as unknown as Ai,
        AI_GATEWAY_NAME: "collects-auto-ai",
        GEMINI_MODEL: "gemini-3.5-flash",
        JD_STORE: env.JD_STORE,
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
