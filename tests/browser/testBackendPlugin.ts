import type { IncomingMessage, ServerResponse } from "node:http";
import type { NextFunction } from "express";
import type { Plugin } from "vite";
import { createApiApp } from "../../src/backend/expressApp";
import { processResumeAnalysisJob } from "../../src/backend/resumeJobs";
import { createTestServices } from "../../src/backend/testImpl";
import type { ResumeAnalysis } from "../../src/shared/types";
import { sampleResume } from "../fixtures/sampleData";

type BackendMode = "auto" | "pending";

type BackendOptions = {
    mode: BackendMode;
    seedResume: boolean;
    seedResumeCount: number;
};

type TestBackend = {
    app: ConnectHandler;
};

type ConnectHandler = (
    request: IncomingMessage,
    response: ServerResponse,
    next: NextFunction,
) => void;

export function testBackendPlugin(): Plugin {
    let backendPromise = createBackend({
        mode: "auto",
        seedResume: false,
        seedResumeCount: 0,
    });

    return {
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                void (async () => {
                    const url = new URL(
                        request.url ?? "/",
                        "http://vitest.local",
                    );

                    if (url.pathname === "/__test/reset") {
                        backendPromise = createBackend({
                            mode:
                                url.searchParams.get("mode") === "pending"
                                    ? "pending"
                                    : "auto",
                            seedResume:
                                url.searchParams.get("seedResume") === "true",
                            seedResumeCount: Number(
                                url.searchParams.get("seedResumeCount") ?? 0,
                            ),
                        });
                        await backendPromise;
                        sendJson(response, { ok: true });
                        return;
                    }

                    if (url.pathname.startsWith("/api/")) {
                        const backend = await backendPromise;

                        backend.app(request, response, next as NextFunction);
                        return;
                    }

                    next();
                })().catch(next);
            });
        },
        name: "resume-analysis-test-backend",
    };
}

async function createBackend(options: BackendOptions): Promise<TestBackend> {
    const services = createTestServices();
    const originalEnqueue = services.resumeAnalysisQueue.enqueue.bind(
        services.resumeAnalysisQueue,
    );
    const originalExtractResumeStream = services.ai.extractResumeStream.bind(
        services.ai,
    );

    services.resumeAnalysisQueue.enqueue = async (job) => {
        await originalEnqueue(job);

        if (options.mode === "auto") {
            await processResumeAnalysisJob(services, job);
        }
    };
    services.ai.extractResumeStream = async (input, callbacks) => {
        const resume = await originalExtractResumeStream(input, callbacks);

        if (options.mode === "pending") {
            await delay(1_000);
        }

        return resume;
    };

    const seedCount = options.seedResumeCount || (options.seedResume ? 1 : 0);

    await Promise.all(
        Array.from({ length: seedCount }, async (_, index) => {
            const resume = createSeedResume(index);
            const upload = await services.resumeStore.createPendingUpload({
                bytes: new Uint8Array(),
                fileName:
                    index === 0
                        ? "asuka.pdf"
                        : `candidate-${index.toString().padStart(2, "0")}.pdf`,
                source: "click",
            });

            await services.resumeStore.completePendingAnalysis(
                upload.resumeId,
                resume,
            );
        }),
    );

    return {
        app: createApiApp(services) as unknown as ConnectHandler,
    };
}

function sendJson(response: ServerResponse, payload: unknown): void {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSeedResume(index: number): ResumeAnalysis {
    if (index === 0) {
        return sampleResume;
    }

    const suffix = index.toString().padStart(2, "0");
    const name = `Candidate ${suffix}`;
    const sampleEducation = sampleResume.edu[0];

    if (!sampleEducation) {
        throw new Error("Sample resume must include an education fixture");
    }

    return {
        ...sampleResume,
        rawText: `${name}\n${name.toLocaleLowerCase().replace(/\s+/g, ".")}@example.com\nFrontend engineer with virtualized table experience.`,
        basic: {
            ...sampleResume.basic,
            email: `${name.toLocaleLowerCase().replace(/\s+/g, ".")}@example.com`,
            name,
        },
        edu: [
            {
                ...sampleEducation,
                degree: index % 2 === 0 ? "Bachelor" : "Master",
            },
        ],
        skills: [
            ...sampleResume.skills,
            { name: `Search Token ${suffix}` },
            { name: "Virtual List" },
        ],
    };
}
