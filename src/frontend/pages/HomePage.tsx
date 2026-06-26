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

            await mutate("resumes.nav-count");
            await mutate("resumes.table");
            send({
                bytes: result.upload.bytes,
                name: result.resume.basic.name,
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
        <section className="grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-10">
            <div
                className="pdf-preview card w-full max-w-3xl border-2 border-dashed border-info bg-base-100 shadow-2xl transition-transform duration-200 hover:-translate-y-1"
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
                            <img
                                alt=""
                                className="h-14 w-14"
                                src="https://cdn.jsdelivr.net/npm/@icon-park/svg@1.4.2/icons/upload.svg"
                            />
                            <img
                                alt=""
                                className="h-14 w-14"
                                src="https://cdn.jsdelivr.net/npm/@icon-park/svg@1.4.2/icons/file-pdf-one.svg"
                            />
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
        </section>
    );
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
