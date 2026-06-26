import express from "express";
import type {
    ErrorRequestHandler,
    Request,
    RequestHandler,
    Response,
} from "express";
import { DuplicateJobDescriptionError, type AppServices } from "./ports";
import {
    contextMetadata,
    createRequestContext,
    durationMs,
    logError,
    logInfo,
    REQUEST_ID_HEADER,
    sha256Hex,
    type ObservabilityContext,
} from "./observability";
import { assertResumePdfPageLimit, PdfPageLimitError } from "./pdf";
import type { UploadSource } from "../shared/types";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const uploadSources = new Set(["click", "drag", "paste"]);

export function createApiApp(services: AppServices): express.Express {
    const app = express();

    app.use(requestObservability);
    app.use("/api/jds", express.json({ limit: "2mb" }));

    app.get("/api/health", (_req, res) => {
        res.json({ ok: true });
    });

    app.post(
        "/api/resumes/analyze",
        express.raw({
            limit: MAX_UPLOAD_BYTES,
            type: ["application/pdf", "application/octet-stream", "*/*"],
        }),
        asyncHandler(async (req, res) => {
            const context = responseContext(res);

            try {
                const fileName = header(req, "x-file-name") ?? "resume.pdf";
                const source = readUploadSource(req);
                const contentType = header(req, "content-type") ?? "";
                const bytes = toBytes(req.body);
                const fileNameHash = await sha256Hex(fileName);
                const inputHash = await sha256Hex(bytes);
                const uploadMetadata = {
                    content_type: contentType,
                    file_extension: fileExtension(fileName),
                    file_name_sha256: fileNameHash,
                    input_bytes: bytes.byteLength,
                    input_sha256: inputHash,
                    upload_source: source,
                };

                if (!isPdf(fileName, contentType, bytes)) {
                    logInfo(
                        "resume.upload.rejected",
                        contextMetadata(context, {
                            ...uploadMetadata,
                            reason: "invalid_pdf",
                        }),
                    );
                    sendError(res, 415, "PDF files only");
                    return;
                }

                try {
                    assertResumePdfPageLimit(bytes);
                } catch (error) {
                    logInfo(
                        "resume.upload.rejected",
                        contextMetadata(context, {
                            ...uploadMetadata,
                            reason:
                                error instanceof PdfPageLimitError
                                    ? error.code
                                    : "pdf_validation_failed",
                        }),
                    );
                    throw error;
                }

                logInfo(
                    "resume.upload.accepted",
                    contextMetadata(context, uploadMetadata),
                );

                const upload = await services.resumeStore.createPendingUpload(
                    {
                        bytes,
                        fileName,
                        source,
                    },
                    context,
                );

                try {
                    await services.resumeAnalysisQueue.enqueue(
                        {
                            requestId: context.requestId,
                            resumeId: upload.resumeId,
                        },
                        context,
                    );
                } catch (error) {
                    await services.resumeStore.failPendingAnalysis(
                        upload.resumeId,
                        context,
                    );
                    logError(
                        "resume.analysis.enqueue_failed",
                        contextMetadata(context, {
                            resume_id: upload.resumeId,
                        }),
                        error,
                    );
                    throw error;
                }

                logInfo(
                    "resume.analysis.enqueued",
                    contextMetadata(context, {
                        resume_id: upload.resumeId,
                    }),
                );

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
                    sendError(
                        res,
                        error.code === "too_many_pages" ? 413 : 422,
                        error.message,
                    );
                    return;
                }

                logError(
                    "resume.analysis.failed",
                    contextMetadata(context),
                    error,
                );
                sendError(
                    res,
                    500,
                    error instanceof Error
                        ? error.message
                        : "Failed to analyze resume",
                );
            }
        }),
    );

    app.get(
        "/api/resumes",
        asyncHandler(async (_req, res) => {
            const context = responseContext(res);
            const resumes = await services.resumeStore.listSummaries(context);

            logInfo(
                "resume.list.completed",
                contextMetadata(context, {
                    resume_count: resumes.length,
                }),
            );

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
            const context = responseContext(res);
            const resumeId = String(req.params.resumeId ?? "");
            const summary = await services.resumeStore.getSummary(
                resumeId,
                context,
            );

            if (!summary) {
                logInfo(
                    "resume.status.not_found",
                    contextMetadata(context, {
                        resume_id: resumeId,
                    }),
                );
                sendError(res, 404, "Resume not found");
                return;
            }

            logInfo(
                "resume.status.completed",
                contextMetadata(context, {
                    resume_id: resumeId,
                    resume_status: summary.status,
                }),
            );

            res.json(summary);
        }),
    );

    app.get(
        "/api/resumes/:resumeId",
        asyncHandler(async (req, res) => {
            const context = responseContext(res);
            const resumeId = String(req.params.resumeId ?? "");
            const document = await services.resumeStore.getById(
                resumeId,
                context,
            );

            if (!document) {
                logInfo(
                    "resume.lookup.not_found",
                    contextMetadata(context, {
                        resume_id: resumeId,
                    }),
                );
                sendError(res, 404, "Resume not found");
                return;
            }

            logInfo(
                "resume.lookup.completed",
                contextMetadata(context, {
                    resume_id: resumeId,
                    resume_status: document.status,
                }),
            );

            res.json(document);
        }),
    );

    app.post(
        "/api/jds/analyze",
        asyncHandler(async (req, res) => {
            const context = responseContext(res);
            const rawText =
                typeof req.body?.rawText === "string"
                    ? req.body.rawText.trim()
                    : "";

            if (!rawText) {
                logInfo(
                    "jd.analysis.rejected",
                    contextMetadata(context, {
                        reason: "missing_raw_text",
                    }),
                );
                sendError(res, 400, "Job description text is required");
                return;
            }

            logInfo(
                "jd.analysis.accepted",
                contextMetadata(context, {
                    input_chars: rawText.length,
                    input_sha256: await sha256Hex(rawText),
                }),
            );

            const jd = await services.ai.analyzeJobDescription(
                rawText,
                context,
            );
            const stored = await services.jdStore.save(jd, context);

            logInfo(
                "jd.analysis.stored",
                contextMetadata(context, {
                    jd_id_sha256: await sha256Hex(stored.id),
                    required_experience_count:
                        stored.requiredExperiences.length,
                    required_skill_count: stored.requiredSkills.length,
                    tag_count: stored.tags.length,
                }),
            );

            res.status(201).json({ jd: stored });
        }),
    );

    app.get(
        "/api/jds",
        asyncHandler(async (_req, res) => {
            const context = responseContext(res);
            const jds = await services.jdStore.listSummaries(context);

            logInfo(
                "jd.list.completed",
                contextMetadata(context, {
                    jd_count: jds.length,
                }),
            );

            res.json({
                count: jds.length,
                jds,
            });
        }),
    );

    app.get(
        "/api/jds/:id",
        asyncHandler(async (req, res) => {
            const context = responseContext(res);
            const id = String(req.params.id ?? "");
            const jd = await services.jdStore.getById(id, context);

            if (!jd) {
                logInfo(
                    "jd.lookup.not_found",
                    contextMetadata(context, {
                        jd_id_sha256: await sha256Hex(id),
                    }),
                );
                sendError(res, 404, "Job description not found");
                return;
            }

            logInfo(
                "jd.lookup.completed",
                contextMetadata(context, {
                    jd_id_sha256: await sha256Hex(id),
                }),
            );

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

const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const context = responseContext(res);

    logError("api.request.failed", contextMetadata(context), error);

    if (error instanceof DuplicateJobDescriptionError) {
        sendError(res, 409, error.message);
        return;
    }

    sendError(
        res,
        500,
        error instanceof Error ? error.message : "Internal server error",
    );
};

function requestObservability(
    req: Request,
    res: Response,
    next: () => void,
): void {
    const startedAt = Date.now();
    const context = createRequestContext({
        method: req.method,
        requestId: header(req, REQUEST_ID_HEADER),
        route: routeLabel(req),
    });

    res.locals.observability = context;
    res.setHeader(REQUEST_ID_HEADER, context.requestId);

    logInfo(
        "api.request.start",
        contextMetadata(context, {
            content_length: header(req, "content-length") ?? null,
            content_type: header(req, "content-type") ?? null,
        }),
    );

    res.on("finish", () => {
        logInfo(
            "api.request.complete",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                status_code: res.statusCode,
            }),
        );
    });

    next();
}

function responseContext(res: Response): ObservabilityContext {
    return (
        (res.locals.observability as ObservabilityContext | undefined) ??
        createRequestContext({})
    );
}

function sendError(res: Response, status: number, message: string): void {
    const requestId = responseContext(res).requestId;

    res.status(status).json({
        error: message,
        requestId,
    });
}

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

function fileExtension(fileName: string): string {
    const [, extension = ""] = fileName.toLowerCase().match(/\.([^.]+)$/) ?? [];

    return extension.slice(0, 20);
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

function routeLabel(req: Request): string {
    if (req.path === "/api/resumes/analyze") {
        return req.path;
    }

    if (req.path === "/api/resumes") {
        return req.path;
    }

    if (req.path.startsWith("/api/resumes/") && req.path.endsWith("/status")) {
        return "/api/resumes/:resumeId/status";
    }

    if (req.path.startsWith("/api/resumes/")) {
        return "/api/resumes/:resumeId";
    }

    if (req.path === "/api/jds/analyze" || req.path === "/api/jds") {
        return req.path;
    }

    if (req.path.startsWith("/api/jds/")) {
        return "/api/jds/:id";
    }

    return req.path;
}
