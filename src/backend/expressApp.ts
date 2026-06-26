import express from "express";
import type {
    ErrorRequestHandler,
    Request,
    RequestHandler,
    Response,
} from "express";
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
import type { AppServices } from "./ports";
import type { UploadSource } from "../shared/types";
import { summarizeResume } from "../shared/types";

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

                if (!isPdf(fileName, contentType, bytes)) {
                    logInfo(
                        "resume.upload.rejected",
                        contextMetadata(context, {
                            content_type: contentType,
                            file_extension: fileExtension(fileName),
                            file_name_sha256: fileNameHash,
                            input_bytes: bytes.byteLength,
                            input_sha256: inputHash,
                            reason: "invalid_pdf",
                            upload_source: source,
                        }),
                    );
                    res.status(415).json({ error: "PDF files only" });
                    return;
                }

                logInfo(
                    "resume.upload.accepted",
                    contextMetadata(context, {
                        content_type: contentType,
                        file_extension: fileExtension(fileName),
                        file_name_sha256: fileNameHash,
                        input_bytes: bytes.byteLength,
                        input_sha256: inputHash,
                        upload_source: source,
                    }),
                );

                const resume = await services.ai.extractResume(
                    {
                        bytes,
                        fileName,
                        source,
                    },
                    context,
                );

                await services.resumeStore.save(resume, context);

                logInfo(
                    "resume.analysis.stored",
                    contextMetadata(context, {
                        education_count: resume.edu.length,
                        project_count: resume.project.length,
                        raw_text_chars: resume.rawText.length,
                        resume_name_sha256: await sha256Hex(resume.basic.name),
                        skill_count: resume.skills.length,
                        work_count: resume.work.length,
                    }),
                );

                res.status(201).json({
                    resume,
                    upload: {
                        bytes: bytes.byteLength,
                        percent: 100,
                        source,
                    },
                });
            } catch (error) {
                logError(
                    "resume.analysis.failed",
                    contextMetadata(context),
                    error,
                );
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
            const context = responseContext(res);
            const resumes = await services.resumeStore.list(context);

            logInfo(
                "resume.list.completed",
                contextMetadata(context, {
                    resume_count: resumes.length,
                }),
            );

            res.json({
                count: resumes.length,
                resumes: resumes.map(summarizeResume),
            });
        }),
    );

    app.get(
        "/api/resumes/info/:name",
        asyncHandler(async (req, res) => {
            const context = responseContext(res);
            const name = String(req.params.name ?? "");
            const resume = await services.resumeStore.getByName(name, context);

            if (!resume) {
                logInfo(
                    "resume.lookup.not_found",
                    contextMetadata(context, {
                        resume_name_sha256: await sha256Hex(name),
                    }),
                );
                res.status(404).json({ error: "Resume not found" });
                return;
            }

            logInfo(
                "resume.lookup.completed",
                contextMetadata(context, {
                    resume_name_sha256: await sha256Hex(name),
                }),
            );

            res.json({ resume });
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
                res.status(400).json({
                    error: "Job description text is required",
                });
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
            await services.jdStore.save(jd, context);

            logInfo(
                "jd.analysis.stored",
                contextMetadata(context, {
                    jd_id_sha256: await sha256Hex(jd.id),
                    required_experience_count: jd.requiredExperiences.length,
                    required_skill_count: jd.requiredSkills.length,
                    tag_count: jd.tags.length,
                }),
            );

            res.status(201).json({ jd });
        }),
    );

    app.get(
        "/api/jds",
        asyncHandler(async (_req, res) => {
            const context = responseContext(res);
            const jds = await services.jdStore.list(context);

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

    app.use(jsonErrorHandler);

    return app;
}

function asyncHandler(handler: RequestHandler): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    logError(
        "api.request.failed",
        contextMetadata(responseContext(res)),
        error,
    );
    res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
    });
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
    if (req.path.startsWith("/api/resumes/info/")) {
        return "/api/resumes/info/:name";
    }

    return req.path;
}
