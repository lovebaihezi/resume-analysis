import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApiApp } from "../../src/backend/expressApp";
import { createTestServices } from "../../src/backend/testImpl";
import {
    parseResumeInfoResult,
    parseResumeStatusResult,
    parseResumeUploadResult,
} from "../../src/shared/schemas";
import type { ResumeStreamEvent } from "../../src/shared/resumeStream";
import { pdfWithPages } from "../fixtures/pdf";

const uuidV7Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("resume and JD API behavior", () => {
    it("accepts a PDF resume upload and exposes creating state by id", async () => {
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

        const creatingStatus = await request(app).get(
            `/api/resumes/${upload.resumeId}/status`,
        );
        expect(creatingStatus.status).toBe(200);
        expect(parseResumeStatusResult(creatingStatus.body)).toMatchObject({
            resumeId: upload.resumeId,
            status: "creating",
        });

        const list = await request(app).get("/api/resumes");
        expect(list.status).toBe(200);
        expect(list.body).toMatchObject({
            count: 0,
            resumes: [],
        });

        const info = await request(app).get(`/api/resumes/${upload.resumeId}`);
        expect(info.status).toBe(404);

        const oldNameRoute = await request(app).get(
            "/api/resumes/info/Ava%20Chen",
        );
        expect(oldNameRoute.status).toBe(404);
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
    });

    it("rejects PDF resumes over the prototype 3 page limit before queueing analysis", async () => {
        const services = createTestServices();
        const app = createApiApp(services);

        const response = await request(app)
            .post("/api/resumes/analyze")
            .set("content-type", "application/pdf")
            .set("x-file-name", "long-resume.pdf")
            .set("x-upload-source", "click")
            .send(pdfWithPages(4, "Long resume"));

        expect(response.status).toBe(413);
        expect(response.body.error).toMatch(/3 pages or fewer/i);
    });

    it("streams resume analysis status, field tokens, completion, and stored ready data", async () => {
        const services = createTestServices();
        const app = createApiApp(services);

        const response = await request(app)
            .post("/api/resumes/analyze/stream")
            .set("accept", "text/event-stream")
            .set("content-type", "application/pdf")
            .set("x-file-name", "ava-chen.pdf")
            .set("x-upload-source", "click")
            .send(pdfWithPages(1, "Ava Chen resume"));

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("text/event-stream");

        const events = parseSseEvents(response.text);

        expect(events.map((event) => event.type)).toContain("status");
        expect(
            events.find(
                (event) =>
                    event.type === "status" &&
                    event.phase === "converting_pdf_to_markdown",
            ),
        ).toMatchObject({
            message: "Converting PDF to markdown",
        });
        expect(
            events.find(
                (event) =>
                    event.type === "token" && event.path === "basic.name",
            ),
        ).toMatchObject({
            value: "Ava Chen",
        });

        const complete = events.find(
            (
                event,
            ): event is Extract<ResumeStreamEvent, { type: "complete" }> =>
                event.type === "complete",
        );

        expect(complete?.resumeId).toMatch(uuidV7Pattern);
        expect(complete?.resume.basic.name).toBe("Ava Chen");

        const detail = await request(app).get(
            `/api/resumes/${complete?.resumeId ?? ""}`,
        );
        expect(detail.status).toBe(200);
        expect(parseResumeInfoResult(detail.body).resume.basic.name).toBe(
            "Ava Chen",
        );
    });

    it("streams proper error events and marks the upload failed when extraction fails", async () => {
        const services = createTestServices({
            onExtractResume: () => {
                throw new Error("Model unavailable");
            },
        });
        const app = createApiApp(services);

        const response = await request(app)
            .post("/api/resumes/analyze/stream")
            .set("accept", "text/event-stream")
            .set("content-type", "application/pdf")
            .set("x-file-name", "ava-chen.pdf")
            .set("x-upload-source", "click")
            .send(pdfWithPages(1, "Ava Chen resume"));

        expect(response.status).toBe(200);

        const events = parseSseEvents(response.text);
        const error = events.find(
            (event): event is Extract<ResumeStreamEvent, { type: "error" }> =>
                event.type === "error",
        );

        expect(error?.message).toMatch(/model unavailable/i);

        const resumeId = services.resumeAnalysisQueue.jobs[0]?.resumeId;
        expect(resumeId).toBeUndefined();
        const failedSummary = [...services.resumeStore.summaries.values()][0];

        expect(failedSummary).toMatchObject({
            status: "failed",
        });
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
        expect(list.body.jds[0].id).toBe("senior-frontend-engineer");

        const detail = await request(app).get(
            "/api/jds/senior-frontend-engineer",
        );
        expect(detail.status).toBe(200);
        expect(detail.body.jd.requiredSkills).toContain("React");
    });

    it("rejects duplicate job description ids", async () => {
        const services = createTestServices();
        const app = createApiApp(services);
        const rawText =
            "Senior frontend engineer role requiring React, XState, Cloudflare Workers, and accessibility experience.";

        const first = await request(app)
            .post("/api/jds/analyze")
            .send({ rawText });
        const duplicate = await request(app)
            .post("/api/jds/analyze")
            .send({ rawText });

        expect(first.status).toBe(201);
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.error).toMatch(/already exists/i);
    });
});

function parseSseEvents(text: string): ResumeStreamEvent[] {
    return text
        .split(/\n\n+/)
        .map((event) =>
            event
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice("data:".length).trimStart())
                .join("\n")
                .trim(),
        )
        .filter(Boolean)
        .map((data) => JSON.parse(data) as ResumeStreamEvent);
}
