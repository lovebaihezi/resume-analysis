import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApiApp } from "../../src/backend/expressApp";
import { createTestServices } from "../../src/backend/testImpl";

describe("resume and JD API behavior", () => {
    it("accepts a PDF resume upload, stores the analyzed resume, and exposes it by name", async () => {
        const services = createTestServices();
        const app = createApiApp(services);

        const response = await request(app)
            .post("/api/resumes/analyze")
            .set("content-type", "application/pdf")
            .set("x-file-name", "ava-chen.pdf")
            .set("x-upload-source", "drag")
            .send(Buffer.from("%PDF-1.7\nAva Chen resume"));

        expect(response.status).toBe(201);
        expect(response.body.resume.basic.name).toBe("Ava Chen");
        expect(response.body.upload.source).toBe("drag");

        const list = await request(app).get("/api/resumes");
        expect(list.status).toBe(200);
        expect(list.body.count).toBe(1);
        expect(list.body.resumes[0]).toMatchObject({
            name: "Ava Chen",
            highestEducation: "Master",
            workDuration: "2020-01-01 to 2024-03-01",
        });

        const info = await request(app).get("/api/resumes/info/Ava%20Chen");
        expect(info.status).toBe(200);
        expect(info.body.resume.rawText).toContain("Ava Chen");
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
        expect(list.body.jds[0]).not.toHaveProperty("rawText");

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
