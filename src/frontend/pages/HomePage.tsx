import { siGoogledocs } from "simple-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import type { ApiClient, UploadSource } from "../apiClient";
import { useAppRuntime } from "../appRuntime";
import { SimpleIcon } from "../components/SimpleIcon";

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
    const showProgressBar = upload.status === "uploading";

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
        if (upload.status === "checking") {
            return "Checking PDF";
        }

        if (upload.status === "analyzing") {
            return "Analyzing resume";
        }

        return "";
    }, [upload.status]);

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

    function openFilePicker() {
        inputRef.current?.click();
    }

    return (
        <section
            className={
                hasSelectedFile
                    ? "grid min-h-[calc(100vh-4rem)] items-center gap-8 px-4 py-10 lg:grid-cols-2 lg:px-10"
                    : "grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-10"
            }
        >
            <input
                ref={inputRef}
                accept="application/pdf,.pdf"
                aria-label="Choose resume PDF"
                className="hidden"
                id="resume-upload-input"
                onChange={(event) => {
                    const file = event.currentTarget.files?.item(0);

                    if (file) {
                        void handleFile(file, "click");
                    }
                }}
                type="file"
            />
            <button
                className={
                    hasSelectedFile
                        ? "pdf-preview card mx-auto w-full max-w-2xl cursor-pointer border-2 border-dashed border-info bg-base-100 shadow-2xl transition focus:outline-none focus:ring-2 focus:ring-info focus:ring-offset-2 focus:ring-offset-base-200 lg:justify-self-center"
                        : "pdf-preview card w-full max-w-3xl cursor-pointer border-2 border-dashed border-info bg-base-100 shadow-2xl transition focus:outline-none focus:ring-2 focus:ring-info focus:ring-offset-2 focus:ring-offset-base-200"
                }
                aria-label="Resume PDF upload area"
                data-testid="resume-dropzone"
                onClick={openFilePicker}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    event.preventDefault();
                    const file = firstFile(event.dataTransfer.files);

                    if (file) {
                        void handleFile(file, "drag");
                    }
                }}
                type="button"
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
                        <SimpleIcon
                            className="h-14 w-14 text-info"
                            icon={siGoogledocs}
                        />
                    )}
                    <p className="text-sm text-base-content/70">
                        Click, drag, or paste a PDF resume.
                    </p>
                    {showProgressBar || progressText ? (
                        <div className="w-full max-w-md">
                            {showProgressBar ? (
                                <progress
                                    className="progress progress-info w-full"
                                    max={100}
                                    value={upload.percent}
                                />
                            ) : null}
                            {progressText ? (
                                <div className="mt-2 text-sm text-base-content/70">
                                    {progressText}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {state.context.error ? (
                        <div className="alert alert-error max-w-md">
                            <span>{state.context.error}</span>
                        </div>
                    ) : null}
                </div>
            </button>
            {showExtractionSkeleton ? <ExtractionSkeleton /> : null}
        </section>
    );
}

function ExtractionSkeleton() {
    return (
        <aside
            aria-busy="true"
            aria-label="Resume extraction preview"
            className="mx-auto w-full max-w-2xl lg:justify-self-center"
            data-testid="resume-extraction-skeleton"
        >
            <div className="rounded border border-base-300 bg-base-100 p-6 shadow-xl">
                <div className="flex items-center justify-between gap-4">
                    <div className="skeleton h-8 w-1/2" />
                    <div className="loading loading-spinner loading-md text-info" />
                </div>
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
