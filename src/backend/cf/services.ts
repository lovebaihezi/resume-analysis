import type {
    AiExtractor,
    AppServices,
    JobDescriptionStore,
    PendingResumeUpload,
    ResumeAnalysisJob,
    ResumeAnalysisQueue,
    ResumeExtractionInput,
    ResumeStore,
    ResumeUploadRecord,
} from "../ports";
import { DuplicateJobDescriptionError } from "../ports";
import { createResumeId } from "../ids";
import {
    contextMetadata,
    durationMs,
    gatewayMetadata,
    type LogMetadata,
    logError,
    logInfo,
    sha256Hex,
    type ObservabilityContext,
} from "../observability";
import { normalizeResumeAnalysis } from "../normalization";
import { parseResumeAnalysis } from "../../shared/schemas";
import type {
    JobDescription,
    JobDescriptionSummary,
    ResumeAnalysis,
    ResumeDocument,
    ResumeMetadata,
    ResumeSummary,
} from "../../shared/types";
import { summarizeResume } from "../../shared/types";
import type {
    JobDescriptionStoreObject,
    ResumeDocumentObject,
    ResumeRegistryObject,
} from "./durableObjects";

const JD_EXTRACTION_MODEL = "@cf/moonshotai/kimi-k2.6";
const DEFAULT_AI_GATEWAY_NAME = "collects-auto-ai";
const DEFAULT_GEMINI_RESUME_MODEL = "gemini-3.5-flash";
const GOOGLE_AI_STUDIO_PROVIDER = "google-ai-studio";
const MAX_RESUME_MARKDOWN_CHARS = 3_500;
const JD_EXTRACTION_MAX_TOKENS = 2048;
const GEMINI_RESUME_MAX_OUTPUT_TOKENS = 4096;
const JD_PROMPT_VERSION = "jd-extract-v1";
const RESUME_PROMPT_VERSION = "resume-extract-v1";
const RESUME_SCHEMA_VERSION = "resume-analysis-v1";
const RESUME_SECTION_PATTERN =
    /(?:^|\n)(?:#{1,6}\s*)?(Education|Work Experience|Open-Source Contributions|Research Experience|Projects?|Skills)\b[^\n]*(?:\n[\s\S]*?)(?=\n(?:#{1,6}\s*)?(?:Education|Work Experience|Open-Source Contributions|Research Experience|Projects?|Skills)\b|$)/gi;
const RESUME_REGISTRY_NAME = "__resume_registry__";
const JD_STORE_NAME = "__jd_store__";
const RESUME_ANALYSIS_RESPONSE_SCHEMA = {
    properties: {
        basic: {
            properties: {
                email: { type: "STRING" },
                name: { type: "STRING" },
                phone: { type: "STRING" },
                socialMedia: {
                    items: {
                        properties: {
                            link: { type: "STRING" },
                            name: { type: "STRING" },
                        },
                        required: ["name", "link"],
                        type: "OBJECT",
                    },
                    type: "ARRAY",
                },
            },
            required: ["name", "socialMedia"],
            type: "OBJECT",
        },
        edu: {
            items: {
                properties: {
                    awards: {
                        items: {
                            properties: {
                                name: { type: "STRING" },
                                value: { type: "STRING" },
                            },
                            required: ["name", "value"],
                            type: "OBJECT",
                        },
                        type: "ARRAY",
                    },
                    degree: { type: "STRING" },
                    experiences: {
                        items: {
                            properties: {
                                des: { type: "STRING" },
                            },
                            required: ["des"],
                            type: "OBJECT",
                        },
                        type: "ARRAY",
                    },
                    school: { type: "STRING" },
                },
                required: ["awards", "experiences"],
                type: "OBJECT",
            },
            type: "ARRAY",
        },
        project: {
            items: {
                properties: {
                    des: { type: "STRING" },
                    duration: {
                        items: { type: "STRING" },
                        type: "ARRAY",
                    },
                    name: { type: "STRING" },
                    role: {
                        enum: ["maintainer", "contributor", "owner"],
                        type: "STRING",
                    },
                    type: {
                        enum: ["open-source", "hobby"],
                        type: "STRING",
                    },
                },
                required: ["duration"],
                type: "OBJECT",
            },
            type: "ARRAY",
        },
        rawText: { type: "STRING" },
        skills: {
            items: {
                properties: {
                    des: { type: "STRING" },
                    name: { type: "STRING" },
                },
                required: ["name"],
                type: "OBJECT",
            },
            type: "ARRAY",
        },
        work: {
            items: {
                properties: {
                    company: { type: "STRING" },
                    des: { type: "STRING" },
                    duration: {
                        items: { type: "STRING" },
                        type: "ARRAY",
                    },
                    level: { type: "STRING" },
                    location: {
                        enum: ["hybrid", "remote", "on-site"],
                        type: "STRING",
                    },
                    role: { type: "STRING" },
                    type: {
                        enum: ["intern", "full-time"],
                        type: "STRING",
                    },
                },
                required: ["duration"],
                type: "OBJECT",
            },
            type: "ARRAY",
        },
    },
    required: ["rawText", "basic", "edu", "work", "project", "skills"],
    type: "OBJECT",
} as const;

export type CloudflareEnv = Omit<
    Env,
    | "AI"
    | "AI_GATEWAY_ID"
    | "GEMINI_MODEL"
    | "JD_STORE"
    | "RESUME_ANALYSIS_QUEUE"
    | "RESUME_DOCUMENT"
    | "RESUME_REGISTRY"
> & {
    AI: Ai;
    AI_GATEWAY_ID?: string;
    AI_GATEWAY_NAME?: string;
    GEMINI_MODEL?: string;
    JD_STORE: DurableObjectNamespace<JobDescriptionStoreObject>;
    RESUME_DOCUMENT: DurableObjectNamespace<ResumeDocumentObject>;
    RESUME_ANALYSIS_QUEUE: Queue<ResumeAnalysisJob>;
    RESUME_REGISTRY: DurableObjectNamespace<ResumeRegistryObject>;
};

export function createCloudflareServices(env: CloudflareEnv): AppServices {
    const aiGatewayId =
        env.AI_GATEWAY_ID ?? env.AI_GATEWAY_NAME ?? DEFAULT_AI_GATEWAY_NAME;

    return {
        ai: new WorkersAiExtractor(
            env.AI,
            aiGatewayId,
            env.GEMINI_MODEL ?? DEFAULT_GEMINI_RESUME_MODEL,
        ),
        jdStore: new DurableObjectJdStore(env.JD_STORE),
        resumeAnalysisQueue: new CloudflareResumeAnalysisQueue(
            env.RESUME_ANALYSIS_QUEUE,
        ),
        resumeStore: new DurableObjectResumeStore(
            env.RESUME_DOCUMENT,
            env.RESUME_REGISTRY,
        ),
    };
}

class DurableObjectResumeStore implements ResumeStore {
    constructor(
        private readonly documents: DurableObjectNamespace<ResumeDocumentObject>,
        private readonly registryNamespace: DurableObjectNamespace<ResumeRegistryObject>,
    ) {}

    async archive(resumeId: string): Promise<ResumeSummary | undefined> {
        const registry = this.registryNamespace.getByName(RESUME_REGISTRY_NAME);
        const existing = await registry.getSummary(resumeId);

        if (!existing) {
            return undefined;
        }

        if (existing.status === "archived") {
            return existing;
        }

        const archivedAt = new Date().toISOString();

        await registry.archive(resumeId, archivedAt);
        await this.documents.getByName(resumeId).archive(archivedAt);

        return (
            (await registry.getSummary(resumeId)) ?? {
                ...existing,
                archivedAt,
                status: "archived",
                updatedAt: archivedAt,
            }
        );
    }

    async createPendingUpload(
        input: ResumeExtractionInput,
        context?: ObservabilityContext,
    ): Promise<ResumeUploadRecord> {
        const startedAt = Date.now();
        const fileNameHash = await sha256Hex(input.fileName);
        const inputHash = await sha256Hex(input.bytes);

        logInfo(
            "resume.store.pending.create.start",
            contextMetadata(context, {
                file_name_sha256: fileNameHash,
                input_bytes: input.bytes.byteLength,
                input_sha256: inputHash,
                upload_source: input.source,
            }),
        );

        const now = new Date().toISOString();
        const resumeId = createResumeId();
        const creating: ResumeMetadata = {
            createdAt: now,
            resumeId,
            status: "creating",
            updatedAt: now,
        };
        const registry = this.registryNamespace.getByName(RESUME_REGISTRY_NAME);

        await registry.create(creating, context);

        const doc = this.documents.getByName(resumeId);
        await doc.initUpload(
            {
                ...creating,
                bytes: input.bytes,
                fileName: input.fileName,
                source: input.source,
            },
            context,
        );

        logInfo(
            "resume.store.pending.create.complete",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                file_name_sha256: fileNameHash,
                input_bytes: input.bytes.byteLength,
                input_sha256: inputHash,
                resume_id: resumeId,
                upload_source: input.source,
            }),
        );

        return {
            ...creating,
            bytes: input.bytes.byteLength,
            fileName: input.fileName,
            source: input.source,
        };
    }

    async completePendingAnalysis(
        resumeId: string,
        resume: ResumeAnalysis,
        context?: ObservabilityContext,
    ): Promise<ResumeDocument> {
        const startedAt = Date.now();
        const normalizedResume = parseResumeAnalysis(
            normalizeResumeAnalysis(resume),
        );
        const resumeNameHash = await sha256Hex(normalizedResume.basic.name);

        logInfo(
            "resume.store.complete.start",
            contextMetadata(context, {
                resume_id: resumeId,
                resume_name_sha256: resumeNameHash,
            }),
        );

        const doc = this.documents.getByName(resumeId);
        const metadata = await doc.getMetadata(context);

        if (!metadata) {
            throw new Error(`Resume upload not found: ${resumeId}`);
        }

        const ready: ResumeMetadata = {
            ...metadata,
            status: "ready",
            updatedAt: new Date().toISOString(),
        };
        const document: ResumeDocument = {
            ...ready,
            resume: normalizedResume,
        };

        await this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .markReady(summarizeResume(normalizedResume, ready), context);
        await doc.markReady(document, context);

        logInfo(
            "resume.store.complete.done",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                education_count: normalizedResume.edu.length,
                project_count: normalizedResume.project.length,
                raw_text_chars: normalizedResume.rawText.length,
                resume_id: resumeId,
                resume_name_sha256: resumeNameHash,
                skill_count: normalizedResume.skills.length,
                work_count: normalizedResume.work.length,
            }),
        );

        return document;
    }

    async failPendingAnalysis(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<void> {
        const startedAt = Date.now();
        const failedAt = new Date().toISOString();

        logInfo(
            "resume.store.fail.start",
            contextMetadata(context, {
                resume_id: resumeId,
            }),
        );

        await this.documents.getByName(resumeId).markFailed(failedAt, context);
        await this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .markFailed(resumeId, failedAt, context);

        logInfo(
            "resume.store.fail.complete",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                resume_id: resumeId,
            }),
        );
    }

    async getById(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<ResumeDocument | undefined> {
        const document = await this.documents.getByName(resumeId).get(context);

        return document?.status === "ready"
            ? {
                  ...document,
                  resume: parseResumeAnalysis(
                      normalizeResumeAnalysis(document.resume),
                  ),
              }
            : undefined;
    }

    async getPendingUpload(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<PendingResumeUpload | undefined> {
        return this.documents.getByName(resumeId).getPendingUpload(context);
    }

    async getSummary(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<ResumeSummary | undefined> {
        return this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .getSummary(resumeId, context);
    }

    async listSummaries(
        context?: ObservabilityContext,
    ): Promise<ResumeSummary[]> {
        return this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .listSummaries(context);
    }

    async count(context?: ObservabilityContext): Promise<number> {
        return this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .count(context);
    }
}

class CloudflareResumeAnalysisQueue implements ResumeAnalysisQueue {
    constructor(private readonly queue: Queue<ResumeAnalysisJob>) {}

    async enqueue(
        job: ResumeAnalysisJob,
        context?: ObservabilityContext,
    ): Promise<void> {
        const startedAt = Date.now();

        logInfo(
            "queue.resume_analysis.enqueue.start",
            contextMetadata(context, {
                resume_id: job.resumeId,
            }),
        );

        await this.queue.send(job);

        logInfo(
            "queue.resume_analysis.enqueue.complete",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                resume_id: job.resumeId,
            }),
        );
    }
}

class DurableObjectJdStore implements JobDescriptionStore {
    constructor(
        private readonly namespace: DurableObjectNamespace<JobDescriptionStoreObject>,
    ) {}

    async save(
        jd: JobDescription,
        context?: ObservabilityContext,
    ): Promise<JobDescription> {
        const startedAt = Date.now();
        const idHash = await sha256Hex(jd.id);

        logInfo(
            "jd.store.save.start",
            contextMetadata(context, {
                jd_id_sha256: idHash,
            }),
        );

        const result = await this.namespace
            .getByName(JD_STORE_NAME)
            .create(jd, context);

        if (!result.ok) {
            logInfo(
                "jd.store.save.duplicate",
                contextMetadata(context, {
                    jd_id_sha256: idHash,
                }),
            );
            throw new DuplicateJobDescriptionError(jd.id);
        }

        logInfo(
            "jd.store.save.complete",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                jd_id_sha256: idHash,
            }),
        );

        return result.jd;
    }

    async getById(
        id: string,
        context?: ObservabilityContext,
    ): Promise<JobDescription | undefined> {
        return this.namespace.getByName(JD_STORE_NAME).getById(id, context);
    }

    async listSummaries(
        context?: ObservabilityContext,
    ): Promise<JobDescriptionSummary[]> {
        return this.namespace.getByName(JD_STORE_NAME).listSummaries(context);
    }

    async count(context?: ObservabilityContext): Promise<number> {
        return this.namespace.getByName(JD_STORE_NAME).count(context);
    }
}

class WorkersAiExtractor implements AiExtractor {
    constructor(
        private readonly ai: Ai,
        private readonly gatewayId?: string,
        private readonly geminiResumeModel = DEFAULT_GEMINI_RESUME_MODEL,
    ) {}

    async extractResume(
        input: ResumeExtractionInput,
        context?: ObservabilityContext,
    ): Promise<ResumeAnalysis> {
        const inputSha256 = await sha256Hex(input.bytes);
        const markdown = await this.pdfToMarkdown(input, context, inputSha256);
        const response = await this.runGeminiResumePrompt(
            resumePrompt(input, markdown),
            {
                context,
                inputBytes: input.bytes.byteLength,
                inputKind: "resume_pdf",
                inputSha256,
                model: this.geminiResumeModel,
                promptVersion: RESUME_PROMPT_VERSION,
                schemaVersion: RESUME_SCHEMA_VERSION,
                task: "resume_extract",
                uploadSource: input.source,
            },
        );

        return parseResumeAnalysis(normalizeResumeAnalysis(response));
    }

    async analyzeJobDescription(
        rawText: string,
        context?: ObservabilityContext,
    ): Promise<JobDescription> {
        const response = await this.runJsonPrompt(
            JD_EXTRACTION_MODEL,
            "job-description",
            jdPrompt(rawText),
            {
                context,
                inputChars: rawText.length,
                inputKind: "job_description_text",
                inputSha256: await sha256Hex(rawText),
                model: JD_EXTRACTION_MODEL,
                promptVersion: JD_PROMPT_VERSION,
                task: "jd_extract",
            },
        );

        return normalizeJd(response, rawText);
    }

    private async runJsonPrompt(
        model: string,
        task: "job-description",
        content: string,
        metadata: AiRequestMetadata,
    ): Promise<unknown> {
        const startedAt = Date.now();
        const maxTokens = JD_EXTRACTION_MAX_TOKENS;
        const eventId = metadata.context?.requestId ?? crypto.randomUUID();
        const logMetadata = aiLogMetadata(metadata, {
            ai_gateway_enabled: Boolean(this.gatewayId),
            gateway_event_id: eventId,
            max_tokens: maxTokens,
            prompt_chars: content.length,
            task,
        });

        logInfo("ai.request.start", logMetadata);

        try {
            const response = await this.ai.run(
                model,
                {
                    chat_template_kwargs: {
                        clear_thinking: true,
                        enable_thinking: false,
                    },
                    max_completion_tokens: maxTokens,
                    max_tokens: maxTokens,
                    messages: [
                        {
                            content:
                                "You extract hiring documents and return only valid JSON. Do not include reasoning, analysis, explanations, or markdown.",
                            role: "system",
                        },
                        {
                            content,
                            role: "user",
                        },
                    ],
                    response_format: {
                        type: "json_object",
                    },
                    reasoning_effort: "low",
                    temperature: 0,
                },
                this.gatewayId
                    ? {
                          extraHeaders: {
                              "cf-aig-collect-log-payload": "false",
                          },
                          gateway: {
                              cacheTtl: 3600,
                              collectLog: true,
                              eventId,
                              id: this.gatewayId,
                              metadata: gatewayMetadata(metadata.context, {
                                  inputKind: metadata.inputKind,
                                  task: metadata.task,
                              }),
                              skipCache: false,
                          },
                      }
                    : undefined,
            );

            try {
                const parsed = parseAiJson(response);

                logInfo("ai.request.complete", {
                    ...logMetadata,
                    duration_ms: durationMs(startedAt),
                });

                return parsed;
            } catch (error) {
                const text = readAiText(response);

                logError(
                    "ai.request.parse_failed",
                    {
                        ...logMetadata,
                        duration_ms: durationMs(startedAt),
                        text_chars: text.length,
                    },
                    error,
                );
                throw new Error(
                    `${model} returned invalid JSON: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    {
                        cause: error,
                    },
                );
            }
        } catch (error) {
            logError(
                "ai.request.failed",
                {
                    ...logMetadata,
                    duration_ms: durationMs(startedAt),
                },
                error,
            );
            throw error;
        }
    }

    private async runGeminiResumePrompt(
        content: string,
        metadata: AiRequestMetadata,
    ): Promise<unknown> {
        if (!this.gatewayId) {
            throw new Error(
                "AI Gateway name is required for resume extraction",
            );
        }

        const startedAt = Date.now();
        const endpoint = `v1beta/models/${this.geminiResumeModel}:generateContent`;
        const eventId = metadata.context?.requestId ?? crypto.randomUUID();
        const logMetadata = aiLogMetadata(metadata, {
            ai_gateway_enabled: true,
            endpoint,
            gateway_event_id: eventId,
            max_output_tokens: GEMINI_RESUME_MAX_OUTPUT_TOKENS,
            prompt_chars: content.length,
            provider: GOOGLE_AI_STUDIO_PROVIDER,
        });

        logInfo("ai.request.start", logMetadata);

        try {
            const response = await this.ai.gateway(this.gatewayId).run(
                {
                    endpoint,
                    headers: {
                        "Content-Type": "application/json",
                        "cf-aig-collect-log-payload": "false",
                    },
                    provider: GOOGLE_AI_STUDIO_PROVIDER,
                    query: {
                        contents: [
                            {
                                parts: [{ text: content }],
                                role: "user",
                            },
                        ],
                        generationConfig: {
                            maxOutputTokens: GEMINI_RESUME_MAX_OUTPUT_TOKENS,
                            responseMimeType: "application/json",
                            responseSchema: RESUME_ANALYSIS_RESPONSE_SCHEMA,
                            temperature: 0,
                        },
                    },
                },
                {
                    extraHeaders: {
                        "cf-aig-collect-log-payload": "false",
                    },
                    gateway: {
                        cacheTtl: 3600,
                        collectLog: true,
                        eventId,
                        id: this.gatewayId,
                        metadata: gatewayMetadata(metadata.context, {
                            inputKind: metadata.inputKind,
                            task: metadata.task,
                        }),
                        skipCache: false,
                    },
                },
            );
            const responseText = await response.text();

            if (!response.ok) {
                throw new Error(
                    `${this.geminiResumeModel} extraction failed with HTTP ${response.status}`,
                );
            }

            const payload = JSON.parse(responseText) as unknown;
            const text = readGeminiText(payload);

            if (!text) {
                throw new Error("Gemini response did not include text content");
            }

            const parsed = parseAiJson(text);

            logInfo("ai.request.complete", {
                ...logMetadata,
                duration_ms: durationMs(startedAt),
                response_chars: responseText.length,
                status_code: response.status,
            });

            return parsed;
        } catch (error) {
            logError(
                "ai.request.failed",
                {
                    ...logMetadata,
                    duration_ms: durationMs(startedAt),
                },
                error,
            );
            throw error;
        }
    }

    private async pdfToMarkdown(
        input: ResumeExtractionInput,
        context: ObservabilityContext | undefined,
        inputSha256: string,
    ): Promise<string> {
        const startedAt = Date.now();
        const fileNameHash = await sha256Hex(input.fileName);
        const logMetadata = contextMetadata(context, {
            file_name_sha256: fileNameHash,
            input_bytes: input.bytes.byteLength,
            input_sha256: inputSha256,
            task: "resume_to_markdown",
            upload_source: input.source,
        });

        logInfo("ai.markdown.start", logMetadata);

        try {
            const result = (await this.ai.toMarkdown(
                {
                    blob: new Blob([bytesToArrayBuffer(input.bytes)], {
                        type: "application/pdf",
                    }),
                    name: input.fileName,
                },
                {
                    conversionOptions: {
                        pdf: {
                            images: {
                                convert: false,
                            },
                            metadata: false,
                        },
                    },
                },
            )) as ConversionResponse;

            if (result.format === "error") {
                throw new Error(
                    `PDF markdown conversion failed: ${result.error}`,
                );
            }

            const markdown = compactResumeMarkdown(result.data);

            logInfo("ai.markdown.complete", {
                ...logMetadata,
                compacted: markdown.length !== result.data.length,
                duration_ms: durationMs(startedAt),
                markdown_chars: markdown.length,
                source_markdown_chars: result.data.length,
                source_tokens: result.tokens,
            });

            return markdown;
        } catch (error) {
            logError(
                "ai.markdown.failed",
                {
                    ...logMetadata,
                    duration_ms: durationMs(startedAt),
                },
                error,
            );
            throw error;
        }
    }
}

type ConversionResponse =
    | {
          data: string;
          format: "markdown";
          tokens?: number;
      }
    | {
          error: string;
          format: "error";
      };

type AiRequestMetadata = {
    context?: ObservabilityContext;
    inputBytes?: number;
    inputChars?: number;
    inputKind: string;
    inputSha256: string;
    model: string;
    promptVersion: string;
    schemaVersion?: string;
    task: string;
    uploadSource?: string;
};

function resumePrompt(input: ResumeExtractionInput, markdown: string): string {
    return `Extract this PDF resume text into concise JSON with keys rawText, basic, edu, work, project, skills.
Schema:
{
  "rawText": "string, <=600 chars summary/source excerpt, not the full resume",
  "basic": {"name": "string", "email": "string", "phone": "string", "socialMedia": [{"name": "string", "link": "string"}]},
  "edu": [{"school": "string", "degree": "string", "awards": [{"name": "string", "value": "string"}], "experiences": [{"des": "string"}]}],
  "work": [{"company": "string", "duration": ["ISO date"], "type": "intern|full-time", "location": "hybrid|remote|on-site", "level": "string", "role": "string", "des": "string"}],
  "project": [{"name": "string", "duration": ["ISO date"], "type": "open-source|hobby", "role": "maintainer|contributor|owner", "des": "string"}],
  "skills": [{"name": "string", "des": "string"}]
}
Missing non-enum string fields must become empty strings. Missing arrays must become empty arrays.
When work.type, work.location, project.type, or project.role is unknown, omit that field instead of returning an empty string.
Keep descriptions under 180 chars and skills under 80 chars. Return only valid minified JSON.
File name: ${input.fileName}
Upload source: ${input.source}
Markdown resume excerpt:
${markdown}`;
}

function jdPrompt(rawText: string): string {
    return `Extract this job description into JSON with keys id, title, rawText, des, tags, requiredSkills, requiredExperiences.
Use a URL-safe id derived from the title. Return only JSON.
Raw JD:
${rawText}`;
}

function parseAiJson(response: unknown): unknown {
    const directJson = readDirectJson(response);

    if (directJson) {
        return directJson;
    }

    const text = readAiText(response);
    const trimmed = text.trim();

    if (!trimmed) {
        throw new Error("AI response did not include text content");
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced?.[1] ?? trimmed;

    return JSON.parse(jsonText);
}

function readAiText(response: unknown, depth = 0): string {
    if (typeof response === "string") {
        return response;
    }

    if (depth > 2) {
        return "";
    }

    const record = asRecord(response);

    if (!record) {
        return "";
    }

    const directResponse = readString(record.response);

    if (directResponse) {
        return directResponse;
    }

    const directContent = readTextContent(record.content);

    if (directContent) {
        return directContent;
    }

    const outputText = readString(record.output_text);

    if (outputText) {
        return outputText;
    }

    const resultText = readAiText(record.result, depth + 1);

    if (resultText) {
        return resultText;
    }

    const choices = Array.isArray(record.choices) ? record.choices : [];

    for (const choice of choices) {
        const choiceRecord = asRecord(choice);

        if (!choiceRecord) {
            continue;
        }

        const message = asRecord(choiceRecord.message);
        const messageContent = readTextContent(message?.content);

        if (messageContent) {
            return messageContent;
        }

        const text = readString(choiceRecord.text);

        if (text) {
            return text;
        }
    }

    return "";
}

function readGeminiText(response: unknown): string {
    const record = asRecord(response);
    const candidates = Array.isArray(record?.candidates)
        ? record.candidates
        : [];

    for (const candidate of candidates) {
        const candidateRecord = asRecord(candidate);
        const content = asRecord(candidateRecord?.content);
        const text = readTextContent(content?.parts);

        if (text) {
            return text;
        }
    }

    return "";
}

function readDirectJson(
    response: unknown,
): Record<string, unknown> | undefined {
    const record = asRecord(response);

    if (!record) {
        return undefined;
    }

    const result = readDirectJson(record.result);

    if (result) {
        return result;
    }

    return isAppJson(record) ? record : undefined;
}

function isAppJson(record: Record<string, unknown>): boolean {
    return (
        ("rawText" in record && "basic" in record) ||
        ("title" in record &&
            "requiredSkills" in record &&
            "requiredExperiences" in record)
    );
}

function aiLogMetadata(
    metadata: AiRequestMetadata,
    extra: LogMetadata = {},
): LogMetadata {
    return contextMetadata(metadata.context, {
        ...extra,
        input_bytes: metadata.inputBytes,
        input_chars: metadata.inputChars,
        input_kind: metadata.inputKind,
        input_sha256: metadata.inputSha256,
        model: metadata.model,
        prompt_version: metadata.promptVersion,
        schema_version: metadata.schemaVersion,
        task: metadata.task,
        upload_source: metadata.uploadSource,
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTextContent(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value.length > 0 ? value : undefined;
    }

    if (!Array.isArray(value)) {
        return undefined;
    }

    const parts = value
        .map((part) => {
            if (typeof part === "string") {
                return part;
            }

            const record = asRecord(part);

            return (
                readString(record?.text) ?? readString(record?.content) ?? ""
            );
        })
        .filter(Boolean);

    return parts.length > 0 ? parts.join("") : undefined;
}

function normalizeJd(data: unknown, rawText: string): JobDescription {
    const value = data as Partial<JobDescription>;
    const title = value.title?.trim() || "Untitled Job Description";

    return {
        des: value.des ?? "",
        id: value.id?.trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        rawText,
        requiredExperiences: value.requiredExperiences ?? [],
        requiredSkills: value.requiredSkills ?? [],
        tags: value.tags ?? [],
        title,
    };
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    return buffer;
}

function compactResumeMarkdown(markdown: string): string {
    const normalized = markdown
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (normalized.length <= MAX_RESUME_MARKDOWN_CHARS) {
        return normalized;
    }

    const sections = [...normalized.matchAll(RESUME_SECTION_PATTERN)].map(
        (match) => match[0].trim(),
    );

    if (sections.length >= 3) {
        const header = normalized.slice(0, 600);
        const sectionBudget = Math.max(
            400,
            Math.floor(
                (MAX_RESUME_MARKDOWN_CHARS - header.length - 120) /
                    sections.length,
            ),
        );
        const compacted = [
            header,
            ...sections.map((section) => section.slice(0, sectionBudget)),
        ].join("\n\n[section excerpt]\n\n");

        return hardLimitMarkdown(compacted);
    }

    const chunkSize = Math.floor((MAX_RESUME_MARKDOWN_CHARS - 120) / 3);
    const midpoint = Math.floor(normalized.length / 2);
    const middleStart = Math.max(0, midpoint - Math.floor(chunkSize / 2));

    return hardLimitMarkdown(
        [
            normalized.slice(0, chunkSize),
            normalized.slice(middleStart, middleStart + chunkSize),
            normalized.slice(-chunkSize),
        ].join("\n\n[resume excerpt omitted]\n\n"),
    );
}

function hardLimitMarkdown(markdown: string): string {
    if (markdown.length <= MAX_RESUME_MARKDOWN_CHARS) {
        return markdown;
    }

    return `${markdown.slice(0, MAX_RESUME_MARKDOWN_CHARS)}\n\n[truncated]`;
}
