import type { IncomingMessage, ServerResponse } from "node:http";
import type { NextFunction } from "express";
import type { Plugin } from "vite";
import { createApiApp } from "../../src/backend/expressApp";
import { processResumeAnalysisJob } from "../../src/backend/resumeJobs";
import { createTestServices } from "../../src/backend/testImpl";
import { sampleResume } from "../fixtures/sampleData";

type BackendMode = "auto" | "pending";

type BackendOptions = {
    mode: BackendMode;
    seedResume: boolean;
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

    services.resumeAnalysisQueue.enqueue = async (job) => {
        await originalEnqueue(job);

        if (options.mode === "auto") {
            await processResumeAnalysisJob(services, job);
        }
    };

    if (options.seedResume) {
        const upload = await services.resumeStore.createPendingUpload({
            bytes: new Uint8Array(),
            fileName: "ava-chen.pdf",
            source: "click",
        });

        await services.resumeStore.completePendingAnalysis(
            upload.resumeId,
            sampleResume,
        );
    }

    return {
        app: createApiApp(services) as unknown as ConnectHandler,
    };
}

function sendJson(response: ServerResponse, payload: unknown): void {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
}
