import express from "express";
import type {
    ErrorRequestHandler,
    Request,
    RequestHandler,
    Response,
} from "express";
import { DuplicateJobDescriptionError, type AppServices } from "./ports";
import type { UploadSource } from "../shared/types";
import { assertResumePdfPageLimit, PdfPageLimitError } from "./pdf";
import type { ResumeStreamEvent } from "../shared/resumeStream";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const uploadSources = new Set(["click", "drag", "paste"]);

export function createApiApp(services: AppServices): express.Express {
    const app = express();

    app.use("/api/jds", express.json({ limit: "2mb" }));

    app.get("/api/health", (_req, res) => {
        res.json({ ok: true });
    });

    app.post(
        "/api/resumes/analyze/stream",
        express.raw({
            limit: MAX_UPLOAD_BYTES,
            type: ["application/pdf", "application/octet-stream", "*/*"],
        }),
        asyncHandler(async (req, res) => {
            const fileName = header(req, "x-file-name") ?? "resume.pdf";
            const source = readUploadSource(req);
            const contentType = header(req, "content-type") ?? "";
            const bytes = toBytes(req.body);

            if (!isPdf(fileName, contentType, bytes)) {
                res.status(415).json({ error: "PDF files only" });
                return;
            }

            try {
                assertResumePdfPageLimit(bytes);
            } catch (error) {
                if (error instanceof PdfPageLimitError) {
                    res.status(
                        error.code === "too_many_pages" ? 413 : 422,
                    ).json({
                        error: error.message,
                    });
                    return;
                }

                throw error;
            }

            const upload = await services.resumeStore.createPendingUpload({
                bytes,
                fileName,
                source,
            });

            prepareSse(res);

            const sendEvent = (event: ResumeStreamEvent) => {
                writeSse(res, event.type, event);
            };

            try {
                const resume = await services.ai.extractResumeStream(
                    {
                        bytes,
                        fileName,
                        source,
                    },
                    {
                        onStatus: (event) => {
                            sendEvent({
                                message: event.message,
                                phase: event.phase,
                                type: "status",
                            });
                        },
                        onToken: (token) => {
                            sendEvent({
                                path: token.path,
                                patch: token.patch,
                                type: "token",
                                value: token.value,
                            });
                        },
                    },
                );

                sendEvent({
                    message: "Saving extracted resume",
                    phase: "saving_resume",
                    type: "status",
                });

                const document =
                    await services.resumeStore.completePendingAnalysis(
                        upload.resumeId,
                        resume,
                    );

                sendEvent({
                    resume: document.resume,
                    resumeId: document.resumeId,
                    type: "complete",
                });
            } catch (error) {
                await services.resumeStore.failPendingAnalysis(upload.resumeId);
                sendEvent({
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to analyze resume",
                    type: "error",
                });
            } finally {
                res.end();
            }
        }),
    );

    app.post(
        "/api/resumes/analyze",
        express.raw({
            limit: MAX_UPLOAD_BYTES,
            type: ["application/pdf", "application/octet-stream", "*/*"],
        }),
        asyncHandler(async (req, res) => {
            try {
                const fileName = header(req, "x-file-name") ?? "resume.pdf";
                const source = readUploadSource(req);
                const contentType = header(req, "content-type") ?? "";
                const bytes = toBytes(req.body);

                if (!isPdf(fileName, contentType, bytes)) {
                    res.status(415).json({ error: "PDF files only" });
                    return;
                }

                assertResumePdfPageLimit(bytes);

                const upload = await services.resumeStore.createPendingUpload({
                    bytes,
                    fileName,
                    source,
                });

                try {
                    await services.resumeAnalysisQueue.enqueue({
                        resumeId: upload.resumeId,
                    });
                } catch (error) {
                    await services.resumeStore.failPendingAnalysis(
                        upload.resumeId,
                    );
                    throw error;
                }

                res.status(202).json({
                    archivedAt: upload.archivedAt,
                    createdAt: upload.createdAt,
                    resumeId: upload.resumeId,
                    status: upload.status,
                    updatedAt: upload.updatedAt,
                    upload: {
                        bytes: bytes.byteLength,
                        percent: 100,
                        source,
                    },
                });
            } catch (error) {
                if (error instanceof PdfPageLimitError) {
                    res.status(
                        error.code === "too_many_pages" ? 413 : 422,
                    ).json({
                        error: error.message,
                    });
                    return;
                }

                res.status(500).json({
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to analyze resume",
                });
            }
        }),
    );

    app.get(
        "/api/resumes",
        asyncHandler(async (_req, res) => {
            const resumes = await services.resumeStore.listSummaries();

            res.json({
                count: resumes.length,
                resumes,
            });
        }),
    );

    app.delete(
        "/api/resumes/:resumeId",
        asyncHandler(async (req, res) => {
            const resumeId = String(req.params.resumeId ?? "");
            const archived = await services.resumeStore.archive(resumeId);

            if (!archived) {
                res.status(404).json({ error: "Resume not found" });
                return;
            }

            res.status(204).send();
        }),
    );

    app.get(
        "/api/resumes/:resumeId/status",
        asyncHandler(async (req, res) => {
            const resumeId = String(req.params.resumeId ?? "");
            const summary = await services.resumeStore.getSummary(resumeId);

            if (!summary) {
                res.status(404).json({ error: "Resume not found" });
                return;
            }

            res.json(summary);
        }),
    );

    app.get(
        "/api/resumes/:resumeId",
        asyncHandler(async (req, res) => {
            const resumeId = String(req.params.resumeId ?? "");
            const document = await services.resumeStore.getById(resumeId);

            if (!document) {
                res.status(404).json({ error: "Resume not found" });
                return;
            }

            res.json(document);
        }),
    );

    app.post(
        "/api/jds/analyze",
        asyncHandler(async (req, res) => {
            const rawText =
                typeof req.body?.rawText === "string"
                    ? req.body.rawText.trim()
                    : "";

            if (!rawText) {
                res.status(400).json({
                    error: "Job description text is required",
                });
                return;
            }

            const jd = await services.ai.analyzeJobDescription(rawText);
            const stored = await services.jdStore.save(jd);

            res.status(201).json({ jd: stored });
        }),
    );

    app.post(
        "/api/jds/match",
        asyncHandler(async (req, res) => {
            const rawText =
                typeof req.body?.rawText === "string"
                    ? req.body.rawText.trim()
                    : "";
            const resumeId =
                typeof req.body?.resumeId === "string"
                    ? req.body.resumeId.trim()
                    : "";

            if (!rawText) {
                res.status(400).json({
                    error: "Job description text is required",
                });
                return;
            }

            if (!resumeId) {
                res.status(400).json({
                    error: "Resume id is required",
                });
                return;
            }

            const resume = await services.resumeStore.getById(resumeId);

            if (!resume) {
                res.status(404).json({ error: "Resume not found" });
                return;
            }

            const analyzedJd = await services.ai.analyzeJobDescription(rawText);
            const jd = await saveOrReuseJobDescription(
                services.jdStore,
                analyzedJd,
            );
            const match = await services.ai.matchResumeToJobDescription(
                jd,
                resume,
            );

            res.status(201).json({ jd, match });
        }),
    );

    app.get(
        "/api/jds",
        asyncHandler(async (_req, res) => {
            const jds = await services.jdStore.listSummaries();

            res.json({
                count: jds.length,
                jds,
            });
        }),
    );

    app.get(
        "/api/jds/:id",
        asyncHandler(async (req, res) => {
            const id = String(req.params.id ?? "");
            const jd = await services.jdStore.getById(id);

            if (!jd) {
                res.status(404).json({ error: "Job description not found" });
                return;
            }

            res.json({ jd });
        }),
    );

    app.use(jsonErrorHandler);

    return app;
}

function asyncHandler(handler: RequestHandler): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

async function saveOrReuseJobDescription(
    store: AppServices["jdStore"],
    jd: Awaited<ReturnType<AppServices["ai"]["analyzeJobDescription"]>>,
) {
    try {
        return await store.save(jd);
    } catch (error) {
        if (error instanceof DuplicateJobDescriptionError) {
            const existing = await store.getById(jd.id);

            if (existing) {
                return existing;
            }
        }

        throw error;
    }
}

const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof DuplicateJobDescriptionError) {
        res.status(409).json({ error: error.message });
        return;
    }

    res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
    });
};

function header(req: Request, name: string): string | undefined {
    const value = req.headers[name];

    if (Array.isArray(value)) {
        return value[0];
    }

    return value;
}

function readUploadSource(req: Request): UploadSource {
    const source = header(req, "x-upload-source");

    return uploadSources.has(source ?? "") ? (source as UploadSource) : "click";
}

function toBytes(body: unknown): Uint8Array {
    if (body instanceof Uint8Array) {
        return body;
    }

    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }

    if (ArrayBuffer.isView(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }

    if (typeof body === "string") {
        return new TextEncoder().encode(body);
    }

    return new Uint8Array();
}

function isPdf(
    fileName: string,
    contentType: string,
    bytes: Uint8Array,
): boolean {
    const hasPdfName = fileName.toLowerCase().endsWith(".pdf");
    const hasPdfType = contentType.toLowerCase().includes("application/pdf");
    const pdfHeader = new TextDecoder().decode(bytes.slice(0, 5));

    return (hasPdfName || hasPdfType) && pdfHeader === "%PDF-";
}

function prepareSse(res: Response): void {
    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();
}

function writeSse(res: Response, eventName: string, payload: unknown): void {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
