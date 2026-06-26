import { useEffect, useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import type { ApiClient, UploadSource } from "../apiClient";
import { useAppRuntime } from "../appRuntime";

type HomePageProps = {
    apiClient: ApiClient;
};

export function HomePage({ apiClient }: HomePageProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string>();
    const { mutate } = useSWRConfig();
    const { send, state } = useAppRuntime();
    const upload = state.context.upload;
    const hasSelectedFile = Boolean(previewUrl);
    const showExtractionSkeleton =
        hasSelectedFile &&
        upload.status !== "idle" &&
        upload.status !== "error" &&
        upload.status !== "done";

    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            const file = firstFile(event.clipboardData?.files);

            if (file) {
                void handleFile(file, "paste");
            }
        };

        window.addEventListener("paste", onPaste);

        return () => window.removeEventListener("paste", onPaste);
    });

    const progressText = useMemo(() => {
        if (upload.status === "idle") {
            return "Ready";
        }

        if (upload.status === "checking") {
            return "Checking PDF...";
        }

        if (upload.status === "analyzing") {
            return "Analyzing resume...";
        }

        return `${upload.percent}% · ${upload.bytes} bytes`;
    }, [upload.bytes, upload.percent, upload.status]);

    async function handleFile(file: File, source: UploadSource): Promise<void> {
        if (!isPdf(file)) {
            send({ message: "PDF files only", type: "UPLOAD_REJECTED" });
            return;
        }

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }

        setPreviewUrl(URL.createObjectURL(file));
        send({ fileName: file.name, source, type: "UPLOAD_STARTED" });

        try {
            const result = await apiClient.uploadResume(
                file,
                source,
                (progress) => {
                    send({ progress, type: "UPLOAD_PROGRESS" });
                },
            );

            send({
                bytes: result.upload.bytes,
                source,
                type: "UPLOAD_ACCEPTED",
            });

            await waitForResumeReady(apiClient, result.resumeId);
            await mutate("resumes.nav-count");
            await mutate("resumes.table");
            send({
                bytes: result.upload.bytes,
                resumeId: result.resumeId,
                source,
                type: "UPLOAD_DONE",
            });
        } catch (error) {
            send({
                message:
                    error instanceof Error
                        ? error.message
                        : "Failed to upload resume",
                type: "UPLOAD_FAILED",
            });
        }
    }

    return (
        <section
            className={
                hasSelectedFile
                    ? "grid min-h-[calc(100vh-4rem)] items-center gap-8 px-4 py-10 lg:grid-cols-2 lg:px-10"
                    : "grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-10"
            }
        >
            <div
                className={
                    hasSelectedFile
                        ? "pdf-preview card mx-auto w-full max-w-2xl border-2 border-dashed border-info bg-base-100 shadow-2xl lg:justify-self-center"
                        : "pdf-preview card w-full max-w-3xl border-2 border-dashed border-info bg-base-100 shadow-2xl"
                }
                data-testid="resume-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    event.preventDefault();
                    const file = firstFile(event.dataTransfer.files);

                    if (file) {
                        void handleFile(file, "drag");
                    }
                }}
            >
                <div className="card-body items-center gap-6 text-center">
                    {previewUrl ? (
                        <object
                            aria-label="First page PDF preview"
                            className="h-72 w-full rounded border border-base-300 bg-base-200"
                            data={previewUrl}
                            type="application/pdf"
                        />
                    ) : (
                        <div className="flex items-center justify-center gap-5">
                            <UploadIcon />
                            <PdfFileIcon />
                        </div>
                    )}
                    <div>
                        <h1 className="text-2xl font-semibold">
                            Upload Your Resume for AI
                        </h1>
                        <p className="mt-2 text-sm text-base-content/70">
                            Click, drag, or paste a PDF resume.
                        </p>
                    </div>
                    <input
                        ref={inputRef}
                        accept="application/pdf,.pdf"
                        aria-label="Choose resume PDF"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.currentTarget.files?.item(0);

                            if (file) {
                                void handleFile(file, "click");
                            }
                        }}
                        type="file"
                    />
                    <button
                        className="btn btn-info min-w-52 text-info-content"
                        onClick={() => inputRef.current?.click()}
                        type="button"
                    >
                        Choose PDF Resume
                    </button>
                    <div className="w-full max-w-md">
                        <progress
                            className="progress progress-info w-full"
                            max={100}
                            value={upload.percent}
                        />
                        <div className="mt-2 text-sm text-base-content/70">
                            {progressText}
                        </div>
                    </div>
                    {state.context.error ? (
                        <div className="alert alert-error max-w-md">
                            <span>{state.context.error}</span>
                        </div>
                    ) : null}
                </div>
            </div>
            {showExtractionSkeleton ? (
                <ExtractionSkeleton
                    fileName={upload.fileName ?? "resume.pdf"}
                    progressText={progressText}
                />
            ) : null}
        </section>
    );
}

function ExtractionSkeleton({
    fileName,
    progressText,
}: {
    fileName: string;
    progressText: string;
}) {
    return (
        <aside
            aria-busy="true"
            aria-label="Resume extraction preview"
            className="mx-auto w-full max-w-2xl lg:justify-self-center"
            data-testid="resume-extraction-skeleton"
        >
            <div className="rounded border border-base-300 bg-base-100 p-6 shadow-xl">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-base-content/70">
                            {fileName}
                        </p>
                        <h2 className="mt-1 text-xl font-semibold">
                            Extracting resume
                        </h2>
                    </div>
                    <div className="loading loading-spinner loading-md text-info" />
                </div>
                <p className="mt-3 text-sm text-base-content/70">
                    {progressText}
                </p>
                <div className="mt-6 space-y-5">
                    <div className="space-y-2">
                        <div className="skeleton h-5 w-1/3" />
                        <div className="skeleton h-4 w-full" />
                        <div className="skeleton h-4 w-5/6" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="skeleton h-24 w-full" />
                        <div className="skeleton h-24 w-full" />
                    </div>
                    <div className="space-y-2">
                        <div className="skeleton h-4 w-2/3" />
                        <div className="skeleton h-4 w-full" />
                        <div className="skeleton h-4 w-4/5" />
                        <div className="skeleton h-4 w-3/5" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <div className="skeleton h-7 w-20 rounded-full" />
                        <div className="skeleton h-7 w-24 rounded-full" />
                        <div className="skeleton h-7 w-16 rounded-full" />
                    </div>
                </div>
            </div>
        </aside>
    );
}

async function waitForResumeReady(
    apiClient: ApiClient,
    resumeId: string,
): Promise<void> {
    const timeoutMs = 120_000;

    await pollResumeStatus(apiClient, resumeId, Date.now() + timeoutMs);
}

async function pollResumeStatus(
    apiClient: ApiClient,
    resumeId: string,
    deadline: number,
): Promise<void> {
    if (Date.now() >= deadline) {
        throw new Error("Resume analysis is still running");
    }

    const status = await apiClient.getResumeStatus(resumeId);

    if (status.status === "ready") {
        return;
    }

    if (status.status === "failed") {
        throw new Error("Resume analysis failed");
    }

    await delay(2_000);
    await pollResumeStatus(apiClient, resumeId, deadline);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPdf(file: File): boolean {
    return (
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
    );
}

function firstFile(files: FileList | File[] | undefined): File | undefined {
    if (!files) {
        return undefined;
    }

    const list = files as FileList;

    if (typeof list.item === "function") {
        return list.item(0) ?? undefined;
    }

    return files[0];
}

function UploadIcon() {
    return (
        <svg
            aria-hidden="true"
            className="h-14 w-14 text-info"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M17 8 12 3 7 8" />
            <path d="M12 3v12" />
        </svg>
    );
}

function PdfFileIcon() {
    return (
        <svg
            aria-hidden="true"
            className="h-14 w-14 text-error"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
            <path d="M7 15h1.5a1.5 1.5 0 0 0 0-3H7v5" />
            <path d="M12 12v5h1.5a2.5 2.5 0 0 0 0-5H12Z" />
            <path d="M17 17v-5h3" />
            <path d="M17 14h2" />
        </svg>
    );
}
