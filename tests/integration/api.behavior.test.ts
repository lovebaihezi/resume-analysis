import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApiApp } from "../../src/backend/expressApp";
import { processResumeAnalysisJob } from "../../src/backend/resumeJobs";
import { createTestServices } from "../../src/backend/testImpl";
import {
    parseResumeInfoResult,
    parseResumeListResult,
    parseResumeStatusResult,
    parseResumeUploadResult,
} from "../../src/shared/schemas";
import { pdfWithPages } from "../fixtures/pdf";

const uuidV7Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("resume and JD API behavior", () => {
    it("accepts a PDF resume upload, queues analysis, and exposes it by id when ready", async () => {
        const services = createTestServices();
        const app = createApiApp(services);

        const response = await request(app)
            .post("/api/resumes/analyze")
            .set("content-type", "application/pdf")
            .set("x-file-name", "ava-chen.pdf")
            .set("x-upload-source", "drag")
            .send(pdfWithPages(1, "Ava Chen resume"));

        expect(response.status).toBe(202);
        const upload = parseResumeUploadResult(response.body);
        expect(upload.resumeId).toMatch(uuidV7Pattern);
        expect(upload.status).toBe("creating");
        expect(upload.createdAt).toEqual(expect.any(String));
        expect(upload.updatedAt).toEqual(expect.any(String));
        expect(upload.upload.source).toBe("drag");
        expect(services.ai.calls.resume).toBe(0);
        expect(services.resumeAnalysisQueue.jobs).toEqual([
            { resumeId: upload.resumeId },
        ]);

        const creatingStatus = await request(app).get(
            `/api/resumes/${upload.resumeId}/status`,
        );
        expect(creatingStatus.status).toBe(200);
        expect(parseResumeStatusResult(creatingStatus.body)).toMatchObject({
            resumeId: upload.resumeId,
            status: "creating",
        });

        // Main coverage gap: this verifies the shared job processor directly, not
        // the Worker's queue() export with message ack/retry behavior.
        await processResumeAnalysisJob(
            services,
            services.resumeAnalysisQueue.jobs[0]!,
        );
        expect(services.ai.calls.resume).toBe(1);

        const list = await request(app).get("/api/resumes");
        expect(list.status).toBe(200);
        expect(list.body.count).toBe(1);
        expect(list.body.resumes[0]).toMatchObject({
            resumeId: upload.resumeId,
            status: "ready",
            name: "Ava Chen",
            highestEducation: "Master",
            workDuration: "2020-01-01 to 2024-03-01",
        });

        const readyStatus = await request(app).get(
            `/api/resumes/${upload.resumeId}/status`,
        );
        expect(parseResumeStatusResult(readyStatus.body)).toMatchObject({
            name: "Ava Chen",
            resumeId: upload.resumeId,
            status: "ready",
        });

        const info = await request(app).get(`/api/resumes/${upload.resumeId}`);
        expect(info.status).toBe(200);
        expect(parseResumeInfoResult(info.body).resume.rawText).toContain(
            "Ava Chen",
        );
        expect(info.body.resumeId).toBe(upload.resumeId);

        const oldNameRoute = await request(app).get(
            "/api/resumes/info/Ava%20Chen",
        );
        expect(oldNameRoute.status).toBe(404);
        expect(await services.resumeStore.count()).toBe(1);
    });

    it("rejects uploads that are not PDF files before calling AI extraction", async () => {
        const services = createTestServices();
        const app = createApiApp(services);

        const response = await request(app)
            .post("/api/resumes/analyze")
            .set("content-type", "text/plain")
            .set("x-file-name", "notes.txt")
            .set("x-upload-source", "click")
            .send("plain text");

        expect(response.status).toBe(415);
        expect(response.body.error).toMatch(/pdf/i);
        expect(await services.resumeStore.count()).toBe(0);
        expect(services.ai.calls.resume).toBe(0);
        expect(services.resumeAnalysisQueue.jobs).toHaveLength(0);
    });

    it("passes uploaded PDF bytes through to the queue job processor", async () => {
        const pdfBytes = pdfWithPages(2, "Kai Tan resume");
        const capturedInputs: Uint8Array[] = [];
        const services = createTestServices({
            onExtractResume(input) {
                capturedInputs.push(new Uint8Array(input.bytes));
            },
        });
        const app = createApiApp(services);

        const response = await request(app)
            .post("/api/resumes/analyze")
            .set("content-type", "application/pdf")
            .set("x-file-name", "kai-tan.pdf")
            .set("x-upload-source", "drag")
            .send(pdfBytes);

        expect(response.status).toBe(202);
        const upload = parseResumeUploadResult(response.body);
        expect(upload.status).toBe("creating");
        expect(capturedInputs).toHaveLength(0);

        await processResumeAnalysisJob(
            services,
            services.resumeAnalysisQueue.jobs[0]!,
        );
        expect(capturedInputs).toHaveLength(1);
        expect([...capturedInputs[0]!]).toEqual([...pdfBytes]);

        const info = await request(app).get(`/api/resumes/${upload.resumeId}`);
        expect(info.status).toBe(200);
        const detail = parseResumeInfoResult(info.body);
        expect(detail.resume.basic.name).toBe("Ava Chen");

        const list = await request(app).get("/api/resumes");
        expect(list.status).toBe(200);
        expect(parseResumeListResult(list.body).count).toBe(1);
        expect(parseResumeListResult(list.body).resumes[0]?.resumeId).toBe(
            upload.resumeId,
        );
    });

    it("stores analyzed job descriptions and lists their structured summaries", async () => {
        const services = createTestServices();
        const app = createApiApp(services);

        const response = await request(app).post("/api/jds/analyze").send({
            rawText:
                "Senior frontend engineer role requiring React, XState, Cloudflare Workers, and accessibility experience.",
        });

        expect(response.status).toBe(201);
        expect(response.body.jd.tags).toContain("frontend");
        expect(response.body.jd.requiredSkills).toContain("React");

        const list = await request(app).get("/api/jds");
        expect(list.status).toBe(200);
        expect(list.body.count).toBe(1);
        expect(list.body.jds[0].title).toBe("Senior Frontend Engineer");
    });
});
