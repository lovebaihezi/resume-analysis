import { assign, setup } from "xstate";
import type { UploadProgress, UploadSource } from "./apiClient";
import type { ResumeStreamPhase } from "../shared/resumeStream";

export type ExtractionStatusMessage = {
    message: string;
    phase: ResumeStreamPhase;
    receivedAt: number;
};

export type ExtractionToken = {
    path: string;
    receivedAt: number;
    value: string;
};

type AppContext = {
    error?: string;
    extraction: {
        messages: ExtractionStatusMessage[];
        tokens: ExtractionToken[];
    };
    navigate: (to: string) => void;
    upload: {
        bytes: number;
        fileName?: string;
        percent: number;
        source?: UploadSource;
        status:
            | "idle"
            | "checking"
            | "uploading"
            | "analyzing"
            | "done"
            | "error";
    };
};

type AppEvent =
    | { type: "NAVIGATE"; to: string }
    | { type: "UPLOAD_REJECTED"; message: string }
    | { type: "UPLOAD_STARTED"; fileName: string; source: UploadSource }
    | { type: "UPLOAD_PROGRESS"; progress: UploadProgress }
    | {
          type: "RESUME_STREAM_STATUS";
          message: string;
          phase: ResumeStreamPhase;
      }
    | {
          type: "RESUME_STREAM_TOKEN";
          path: string;
          value: string;
      }
    | { type: "UPLOAD_ACCEPTED"; bytes: number; source: UploadSource }
    | {
          type: "UPLOAD_DONE";
          bytes: number;
          resumeId: string;
          source: UploadSource;
      }
    | { type: "UPLOAD_FAILED"; message: string };

export const appMachine = setup({
    types: {} as {
        context: AppContext;
        events: AppEvent;
        input: {
            navigate: (to: string) => void;
        };
    },
    actions: {
        pushRoute: ({ context, event }) => {
            if (event.type === "NAVIGATE") {
                context.navigate(event.to);
            }
        },
        pushInfoRoute: ({ context, event }) => {
            if (event.type === "UPLOAD_DONE") {
                context.navigate(`/resumes/${event.resumeId}`);
            }
        },
    },
}).createMachine({
    context: ({ input }) => ({
        extraction: {
            messages: [],
            tokens: [],
        },
        navigate: input.navigate,
        upload: {
            bytes: 0,
            percent: 0,
            status: "idle",
        },
    }),
    id: "resume-analyze-app",
    on: {
        NAVIGATE: {
            actions: "pushRoute",
        },
        RESUME_STREAM_STATUS: {
            actions: assign(({ context, event }) => ({
                error: undefined,
                extraction: {
                    ...context.extraction,
                    messages: [
                        ...context.extraction.messages,
                        {
                            message: event.message,
                            phase: event.phase,
                            receivedAt: Date.now(),
                        },
                    ].slice(-8),
                },
                upload: {
                    ...context.upload,
                    percent: Math.max(context.upload.percent, 100),
                    status: "analyzing" as const,
                },
            })),
        },
        RESUME_STREAM_TOKEN: {
            actions: assign(({ context, event }) => ({
                extraction: {
                    ...context.extraction,
                    tokens: [
                        ...context.extraction.tokens,
                        {
                            path: event.path,
                            receivedAt: Date.now(),
                            value: event.value,
                        },
                    ].slice(-40),
                },
                upload: {
                    ...context.upload,
                    status: "analyzing" as const,
                },
            })),
        },
        UPLOAD_ACCEPTED: {
            actions: assign(({ context, event }) => ({
                error: undefined,
                upload: {
                    bytes: event.bytes,
                    fileName: context.upload.fileName,
                    percent: 100,
                    source: event.source,
                    status: "analyzing" as const,
                },
            })),
        },
        UPLOAD_DONE: {
            actions: [
                assign(({ context, event }) => ({
                    error: undefined,
                    upload: {
                        bytes: event.bytes,
                        fileName: context.upload.fileName,
                        percent: 100,
                        source: event.source,
                        status: "done" as const,
                    },
                })),
                "pushInfoRoute",
            ],
        },
        UPLOAD_FAILED: {
            actions: assign(({ context, event }) => ({
                error: event.message,
                upload: {
                    bytes: context.upload.bytes,
                    fileName: context.upload.fileName,
                    percent: context.upload.percent,
                    source: context.upload.source,
                    status: "error" as const,
                },
            })),
        },
        UPLOAD_PROGRESS: {
            actions: assign(({ context, event }) => ({
                upload: {
                    ...context.upload,
                    bytes: event.progress.loaded,
                    percent: event.progress.percent,
                    status: "uploading" as const,
                },
            })),
        },
        UPLOAD_REJECTED: {
            actions: assign(({ event }) => ({
                error: event.message,
                extraction: {
                    messages: [],
                    tokens: [],
                },
                upload: {
                    bytes: 0,
                    percent: 0,
                    status: "error" as const,
                },
            })),
        },
        UPLOAD_STARTED: {
            actions: assign(({ event }) => ({
                error: undefined,
                extraction: {
                    messages: [],
                    tokens: [],
                },
                upload: {
                    bytes: 0,
                    fileName: event.fileName,
                    percent: 0,
                    source: event.source,
                    status: "checking" as const,
                },
            })),
        },
    },
});
