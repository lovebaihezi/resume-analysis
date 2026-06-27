/* oxlint-disable no-await-in-loop -- SSE readers must process events in arrival order. */
import type {
    JdAnalyzeResult,
    JdInfoResult,
    JdListResult,
    JdMatchResult,
    ResumeInfoResult,
    ResumeListResult,
    ResumeStatusResult,
    ResumeUploadResult,
    UploadSource,
} from "../shared/types";
import type {
    ResumeStreamEvent,
    ResumeTokenPatch,
} from "../shared/resumeStream";
import {
    parseJdAnalyzeResult,
    parseJdInfoResult,
    parseJdListResult,
    parseJdMatchResult,
    parseResumeAnalysis,
    parseResumeInfoResult,
    parseResumeListResult,
    parseResumeStatusResult,
    parseResumeUploadResult,
} from "../shared/schemas";

export type { UploadSource };

export type UploadProgress = {
    loaded: number;
    percent: number;
    total: number;
};

export type ResumeStreamCompleteEvent = Extract<
    ResumeStreamEvent,
    { type: "complete" }
>;

export type ResumeStreamHandlers = {
    onEvent: (event: ResumeStreamEvent) => void;
    onProgress: (progress: UploadProgress) => void;
};

export interface ApiClient {
    uploadResume(
        file: File,
        source: UploadSource,
        onProgress: (progress: UploadProgress) => void,
    ): Promise<ResumeUploadResult>;
    streamAnalyzeResume(
        file: File,
        source: UploadSource,
        handlers: ResumeStreamHandlers,
    ): Promise<ResumeStreamCompleteEvent>;
    archiveResume(resumeId: string): Promise<void>;
    listResumes(): Promise<ResumeListResult>;
    getResumeInfo(resumeId: string): Promise<ResumeInfoResult>;
    getResumeStatus(resumeId: string): Promise<ResumeStatusResult>;
    analyzeJd(rawText: string): Promise<JdAnalyzeResult>;
    matchJdResume(rawText: string, resumeId: string): Promise<JdMatchResult>;
    listJds(): Promise<JdListResult>;
    getJdInfo(id: string): Promise<JdInfoResult>;
}

export const browserApiClient: ApiClient = {
    uploadResume(file, source, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.open("POST", "/api/resumes/analyze");
            xhr.setRequestHeader("content-type", "application/pdf");
            xhr.setRequestHeader("x-file-name", file.name);
            xhr.setRequestHeader("x-upload-source", source);
            xhr.upload.addEventListener("progress", (event) => {
                if (!event.lengthComputable) {
                    return;
                }

                onProgress({
                    loaded: event.loaded,
                    percent: Math.round((event.loaded / event.total) * 100),
                    total: event.total,
                });
            });
            xhr.addEventListener("error", () =>
                reject(new Error("Upload failed")),
            );
            xhr.addEventListener("load", () => {
                const payload = parseJson(xhr.responseText);

                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error(readError(payload) ?? "Upload failed"));
                    return;
                }

                resolve(parseResumeUploadResult(payload));
            });
            xhr.send(file);
        });
    },
    async streamAnalyzeResume(file, source, handlers) {
        const response = await fetch("/api/resumes/analyze/stream", {
            body: file,
            headers: {
                "content-type": "application/pdf",
                "x-file-name": file.name,
                "x-upload-source": source,
            },
            method: "POST",
        });

        handlers.onProgress({
            loaded: file.size,
            percent: 100,
            total: file.size,
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));

            throw new Error(readError(payload) ?? "Upload failed");
        }

        if (!response.body) {
            throw new Error("Resume analysis stream is unavailable");
        }

        let complete: ResumeStreamCompleteEvent | undefined;
        let streamError: Error | undefined;

        await readSseStream(response.body, (payload) => {
            const event = parseResumeStreamEvent(payload);

            handlers.onEvent(event);

            if (event.type === "complete") {
                complete = event;
            }

            if (event.type === "error") {
                streamError = new Error(event.message);
            }
        });

        if (streamError) {
            throw streamError;
        }

        if (!complete) {
            throw new Error("Resume analysis stream ended before completion");
        }

        return complete;
    },
    async listResumes() {
        return parseResumeListResult(await getJson("/api/resumes"));
    },
    async archiveResume(resumeId) {
        await deleteResource(`/api/resumes/${encodeURIComponent(resumeId)}`);
    },
    async getResumeInfo(resumeId) {
        return parseResumeInfoResult(
            await getJson(`/api/resumes/${encodeURIComponent(resumeId)}`),
        );
    },
    async getResumeStatus(resumeId) {
        return parseResumeStatusResult(
            await getJson(
                `/api/resumes/${encodeURIComponent(resumeId)}/status`,
            ),
        );
    },
    async analyzeJd(rawText) {
        return parseJdAnalyzeResult(
            await postJson("/api/jds/analyze", {
                rawText,
            }),
        );
    },
    async matchJdResume(rawText, resumeId) {
        return parseJdMatchResult(
            await postJson("/api/jds/match", {
                rawText,
                resumeId,
            }),
        );
    },
    async listJds() {
        return parseJdListResult(await getJson("/api/jds"));
    },
    async getJdInfo(id) {
        return parseJdInfoResult(
            await getJson(`/api/jds/${encodeURIComponent(id)}`),
        );
    },
};

async function getJson(url: string): Promise<unknown> {
    const response = await fetch(url);
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(readError(payload) ?? "Request failed");
    }

    return payload;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
    const response = await fetch(url, {
        body: JSON.stringify(body),
        headers: {
            "content-type": "application/json",
        },
        method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(readError(payload) ?? "Request failed");
    }

    return payload;
}

async function deleteResource(url: string): Promise<void> {
    const response = await fetch(url, {
        method: "DELETE",
    });

    if (response.ok) {
        return;
    }

    const payload = await response.json().catch(() => ({}));

    throw new Error(readError(payload) ?? "Request failed");
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return {};
    }
}

function readError(payload: unknown): string | undefined {
    if (
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
    ) {
        return payload.error;
    }

    return undefined;
}

async function readSseStream(
    stream: ReadableStream<Uint8Array>,
    onEvent: (payload: unknown) => void,
): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        buffer = normalizeLineEndings(
            buffer + decoder.decode(value, { stream: !done }),
        );

        let separatorIndex = buffer.indexOf("\n\n");

        while (separatorIndex >= 0) {
            const rawEvent = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            readSseEvent(rawEvent, onEvent);
            separatorIndex = buffer.indexOf("\n\n");
        }

        if (done) {
            break;
        }
    }

    if (buffer.trim()) {
        readSseEvent(buffer, onEvent);
    }
}

function readSseEvent(
    rawEvent: string,
    onEvent: (payload: unknown) => void,
): void {
    const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n")
        .trim();

    if (!data || data === "[DONE]") {
        return;
    }

    onEvent(JSON.parse(data) as unknown);
}

function parseResumeStreamEvent(payload: unknown): ResumeStreamEvent {
    const record = asRecord(payload);

    if (!record) {
        throw new Error("Invalid resume analysis stream event");
    }

    const type = record?.type;

    if (type === "status") {
        const phase = record.phase;
        const message = record.message;

        if (
            (phase === "converting_pdf_to_markdown" ||
                phase === "extracting_content_from_markdown" ||
                phase === "saving_resume") &&
            typeof message === "string"
        ) {
            return {
                message,
                phase,
                type,
            };
        }
    }

    if (
        type === "token" &&
        typeof record?.path === "string" &&
        typeof record?.value === "string"
    ) {
        return {
            path: record.path,
            patch: record.patch as ResumeTokenPatch,
            type,
            value: record.value,
        };
    }

    if (
        type === "complete" &&
        typeof record?.resumeId === "string" &&
        record?.resume
    ) {
        return {
            resume: parseResumeAnalysis(record.resume),
            resumeId: record.resumeId,
            type,
        };
    }

    if (type === "error" && typeof record?.message === "string") {
        return {
            message: record.message,
            type,
        };
    }

    throw new Error("Invalid resume analysis stream event");
}

function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
}
