import { CheckCircleIcon } from "@phosphor-icons/react";
import { siGoogledocs } from "simple-icons";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import type { ApiClient, UploadSource } from "../apiClient";
import type { ExtractionStatusMessage, ExtractionToken } from "../appMachine";
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
    const showExtractionPreview =
        hasSelectedFile &&
        upload.status !== "idle" &&
        upload.status !== "error" &&
        upload.status !== "done";
    const showUploadedPdfPreview =
        Boolean(previewUrl) && upload.status === "analyzing";
    const showProgressBar = upload.status === "uploading";
    const latestStreamMessage =
        state.context.extraction.messages.at(-1)?.message;

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
            return latestStreamMessage ?? "Analyzing resume";
        }

        return "";
    }, [latestStreamMessage, upload.status]);

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
            const result = await apiClient.streamAnalyzeResume(file, source, {
                onEvent: (event) => {
                    if (event.type === "status") {
                        send({
                            message: event.message,
                            phase: event.phase,
                            type: "RESUME_STREAM_STATUS",
                        });
                        return;
                    }

                    if (event.type === "token") {
                        send({
                            path: event.path,
                            type: "RESUME_STREAM_TOKEN",
                            value: event.value,
                        });
                    }
                },
                onProgress: (progress) => {
                    send({ progress, type: "UPLOAD_PROGRESS" });
                },
            });

            await mutate("resumes.nav-count");
            await mutate("resumes.table");
            send({
                bytes: file.size,
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
            {showUploadedPdfPreview && previewUrl ? (
                <PdfPreviewPanel previewUrl={previewUrl} />
            ) : (
                <button
                    aria-label="Resume PDF upload area"
                    className={
                        hasSelectedFile
                            ? "pdf-preview card mx-auto w-full max-w-2xl cursor-pointer border-2 border-dashed border-info bg-base-100 shadow-2xl transition focus:outline-none focus:ring-2 focus:ring-info focus:ring-offset-2 focus:ring-offset-base-200 lg:justify-self-center"
                            : "pdf-preview card w-full max-w-3xl cursor-pointer border-2 border-dashed border-info bg-base-100 shadow-2xl transition focus:outline-none focus:ring-2 focus:ring-info focus:ring-offset-2 focus:ring-offset-base-200"
                    }
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
                            <PdfPreviewObject
                                className="h-72"
                                previewUrl={previewUrl}
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
            )}
            {showExtractionPreview ? (
                <ExtractionStreamPreview
                    fileName={upload.fileName ?? "resume.pdf"}
                    messages={state.context.extraction.messages}
                    progressText={progressText}
                    tokens={state.context.extraction.tokens}
                />
            ) : null}
        </section>
    );
}

function PdfPreviewPanel({ previewUrl }: { previewUrl: string }) {
    return (
        <section
            aria-label="Uploaded PDF preview"
            className="pdf-preview mx-auto w-full max-w-2xl rounded border border-base-300 bg-base-100 p-4 shadow-xl lg:justify-self-center"
        >
            <PdfPreviewObject className="h-[32rem]" previewUrl={previewUrl} />
        </section>
    );
}

function PdfPreviewObject({
    className,
    previewUrl,
}: {
    className: string;
    previewUrl: string;
}) {
    return (
        <object
            aria-label="First page PDF preview"
            className={`${className} w-full rounded border border-base-300 bg-base-200`}
            data={previewUrl}
            type="application/pdf"
        />
    );
}

function ExtractionStreamPreview({
    fileName,
    messages,
    progressText,
    tokens,
}: {
    fileName: string;
    messages: ExtractionStatusMessage[];
    progressText: string;
    tokens: ExtractionToken[];
}) {
    const now = useLiveNow(messages.length > 0);

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
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {messages.length > 0 ? (
                        messages.map((message, index) => {
                            const isComplete = index < messages.length - 1;

                            return (
                                <div
                                    className="flex items-center justify-between gap-3 rounded border border-base-300 bg-base-200/60 px-3 py-2 text-sm"
                                    key={`${message.phase}-${message.receivedAt}-${message.message}`}
                                >
                                    <span className="flex min-w-0 items-center gap-3">
                                        {isComplete ? (
                                            <CheckCircleIcon
                                                aria-label={`${message.message} complete`}
                                                className="h-4 w-4 shrink-0 text-success"
                                                weight="fill"
                                            />
                                        ) : (
                                            <span
                                                aria-label={`${message.message} in progress`}
                                                className="loading loading-spinner loading-xs shrink-0 text-info"
                                            />
                                        )}
                                        <span className="truncate">
                                            {message.message}
                                        </span>
                                    </span>
                                    <span
                                        aria-label={`${message.message} duration`}
                                        className="badge badge-outline whitespace-nowrap font-mono text-[0.7rem]"
                                    >
                                        {formatDuration(
                                            statusDurationMs(
                                                messages,
                                                index,
                                                now,
                                            ),
                                        )}
                                    </span>
                                </div>
                            );
                        })
                    ) : (
                        <div className="space-y-2 sm:col-span-2">
                            <div className="skeleton h-4 w-2/3" />
                            <div className="skeleton h-4 w-full" />
                        </div>
                    )}
                </div>
                <div className="mt-5 max-h-80 overflow-y-auto rounded border border-base-300 bg-base-200/60">
                    {tokens.length > 0 ? (
                        <ul className="flex flex-wrap items-start gap-2 p-3">
                            {tokens.map((token) => (
                                <li
                                    aria-label={`${token.path} assigned ${token.value}`}
                                    className="min-w-0 max-w-full rounded border border-base-300 bg-base-100/80 px-2 py-1 text-sm leading-5 break-words text-base-content/80"
                                    key={`${token.path}-${token.receivedAt}-${token.value}`}
                                >
                                    <RenderedLatexAssignment token={token} />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="space-y-2 p-3">
                            <div className="skeleton h-4 w-3/4" />
                            <div className="skeleton h-4 w-full" />
                            <div className="skeleton h-4 w-5/6" />
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}

function RenderedLatexAssignment({ token }: { token: ExtractionToken }) {
    const expression = useMemo(() => latexAssignment(token), [token]);
    const html = useMemo(() => renderLatexAssignment(expression), [expression]);

    return (
        <span
            className="latex-token-assignment inline max-w-full align-middle break-words"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

function renderLatexAssignment(expression: string): string {
    return katex.renderToString(expression, {
        displayMode: false,
        strict: "ignore",
        throwOnError: false,
        trust: false,
    });
}

function latexAssignment(token: ExtractionToken): string {
    return `\\mathrm{${escapeLatex(token.path)}} \\rightarrow \\text{${escapeLatex(token.value)}}`;
}

function useLiveNow(enabled: boolean): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }

        const id = window.setInterval(() => setNow(Date.now()), 250);

        return () => window.clearInterval(id);
    }, [enabled]);

    return now;
}

function statusDurationMs(
    messages: ExtractionStatusMessage[],
    index: number,
    now: number,
): number {
    const current = messages[index];
    const next = messages[index + 1];

    if (!current) {
        return 0;
    }

    return Math.max(0, (next?.receivedAt ?? now) - current.receivedAt);
}

function formatDuration(durationMs: number): string {
    if (durationMs < 1_000) {
        return `${durationMs}ms`;
    }

    return `${(durationMs / 1_000).toFixed(1)}s`;
}

function escapeLatex(value: string): string {
    return value
        .replace(/\\/g, "\\textbackslash{}")
        .replace(/\^/g, "\\textasciicircum{}")
        .replace(/~/g, "\\textasciitilde{}")
        .replace(/[{}_$&#%]/g, (char) => `\\${char}`)
        .replace(/\s+/g, " ")
        .trim();
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
