import type {
    JdAnalyzeResult,
    JdListResult,
    ResumeInfoResult,
    ResumeListResult,
    ResumeStatusResult,
    ResumeUploadResult,
    UploadSource,
} from "../shared/types";
import {
    parseJdAnalyzeResult,
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
    listResumes(): Promise<ResumeListResult>;
    getResumeInfo(resumeId: string): Promise<ResumeInfoResult>;
    getResumeStatus(resumeId: string): Promise<ResumeStatusResult>;
    analyzeJd(rawText: string): Promise<JdAnalyzeResult>;
    listJds(): Promise<JdListResult>;
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
    async listResumes() {
        return parseResumeListResult(await getJson("/api/resumes"));
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
