import type {
    JdAnalyzeResult,
    JdInfoResult,
    JdListResult,
    ResumeInfoResult,
    ResumeListResult,
    ResumeStatusResult,
    ResumeUploadResult,
    UploadSource,
} from "../shared/types";
import {
    parseJdAnalyzeResult,
    parseJdInfoResult,
    parseJdListResult,
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

export interface ApiClient {
    uploadResume(
        file: File,
        source: UploadSource,
        onProgress: (progress: UploadProgress) => void,
    ): Promise<ResumeUploadResult>;
    archiveResume(resumeId: string): Promise<void>;
    listResumes(): Promise<ResumeListResult>;
    getResumeInfo(resumeId: string): Promise<ResumeInfoResult>;
    getResumeStatus(resumeId: string): Promise<ResumeStatusResult>;
    analyzeJd(rawText: string): Promise<JdAnalyzeResult>;
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
                const requestId =
                    xhr.getResponseHeader("x-request-id") ?? undefined;

                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(requestError(payload, "Upload failed", requestId));
                    return;
                }

                resolve(parseResumeUploadResult(payload));
            });
            xhr.send(file);
        });
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
        throw requestError(
            payload,
            "Request failed",
            response.headers.get("x-request-id") ?? undefined,
        );
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
        throw requestError(
            payload,
            "Request failed",
            response.headers.get("x-request-id") ?? undefined,
        );
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

function readRequestId(payload: unknown): string | undefined {
    if (
        payload &&
        typeof payload === "object" &&
        "requestId" in payload &&
        typeof payload.requestId === "string"
    ) {
        return payload.requestId;
    }

    return undefined;
}

function requestError(
    payload: unknown,
    fallback: string,
    requestId?: string,
): Error {
    const message = readError(payload) ?? fallback;
    const resolvedRequestId = readRequestId(payload) ?? requestId;

    return new Error(
        resolvedRequestId
            ? `${message} (request ID: ${resolvedRequestId})`
            : message,
    );
}
