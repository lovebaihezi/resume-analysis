import express from "express";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import type { AppServices } from "./ports";
import { assertResumePdfPageLimit, PdfPageLimitError } from "./pdf";
import type { UploadSource } from "../shared/types";
import { summarizeResume } from "../shared/types";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const uploadSources = new Set(["click", "drag", "paste"]);

export function createApiApp(services: AppServices): express.Express {
    const app = express();

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

                const resume = await services.ai.extractResume({
                    bytes,
                    fileName,
                    source,
                });

                await services.resumeStore.save(resume);

                res.status(201).json({
                    resume,
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
            const resumes = await services.resumeStore.list();

            res.json({
                count: resumes.length,
                resumes: resumes.map(summarizeResume),
            });
        }),
    );

    app.get(
        "/api/resumes/info/:name",
        asyncHandler(async (req, res) => {
            const name = String(req.params.name ?? "");
            const resume = await services.resumeStore.getByName(name);

            if (!resume) {
                res.status(404).json({ error: "Resume not found" });
                return;
            }

            res.json({ resume });
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
            await services.jdStore.save(jd);

            res.status(201).json({ jd });
        }),
    );

    app.get(
        "/api/jds",
        asyncHandler(async (_req, res) => {
            const jds = await services.jdStore.list();

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
