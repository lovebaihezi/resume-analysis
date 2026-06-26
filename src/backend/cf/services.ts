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

export type CloudflareEnv = Env & {
    AI: Ai;
    AI_GATEWAY_NAME?: string;
    GEMINI_MODEL?: string;
    JD_STORE: DurableObjectNamespace<JobDescriptionStoreObject>;
    RESUME_DOCUMENT: DurableObjectNamespace<ResumeDocumentObject>;
    RESUME_ANALYSIS_QUEUE: Queue<ResumeAnalysisJob>;
    RESUME_REGISTRY: DurableObjectNamespace<ResumeRegistryObject>;
};

export function createCloudflareServices(env: CloudflareEnv): AppServices {
    return {
        ai: new WorkersAiExtractor(
            env.AI,
            env.AI_GATEWAY_NAME ?? DEFAULT_AI_GATEWAY_NAME,
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

    async createPendingUpload(
        input: ResumeExtractionInput,
    ): Promise<ResumeUploadRecord> {
        const now = new Date().toISOString();
        const resumeId = createResumeId();
        const creating: ResumeMetadata = {
            createdAt: now,
            resumeId,
            status: "creating",
            updatedAt: now,
        };
        const registry = this.registryNamespace.getByName(RESUME_REGISTRY_NAME);

        await registry.create(creating);

        const doc = this.documents.getByName(resumeId);
        await doc.initUpload({
            ...creating,
            bytes: input.bytes,
            fileName: input.fileName,
            source: input.source,
        });

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
    ): Promise<ResumeDocument> {
        const normalizedResume = parseResumeAnalysis(
            normalizeResumeAnalysis(resume),
        );
        const doc = this.documents.getByName(resumeId);
        const metadata = await doc.getMetadata();

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
            .markReady(summarizeResume(normalizedResume, ready));
        await doc.markReady(document);

        return document;
    }

    async failPendingAnalysis(resumeId: string): Promise<void> {
        const failedAt = new Date().toISOString();

        await this.documents.getByName(resumeId).markFailed(failedAt);
        await this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .markFailed(resumeId, failedAt);
    }

    async getById(resumeId: string): Promise<ResumeDocument | undefined> {
        const document = await this.documents.getByName(resumeId).get();

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
    ): Promise<PendingResumeUpload | undefined> {
        return this.documents.getByName(resumeId).getPendingUpload();
    }

    async getSummary(resumeId: string): Promise<ResumeSummary | undefined> {
        return this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .getSummary(resumeId);
    }

    async listSummaries(): Promise<ResumeSummary[]> {
        return this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .listSummaries();
    }

    async count(): Promise<number> {
        return this.registryNamespace.getByName(RESUME_REGISTRY_NAME).count();
    }
}

class CloudflareResumeAnalysisQueue implements ResumeAnalysisQueue {
    constructor(private readonly queue: Queue<ResumeAnalysisJob>) {}

    async enqueue(job: ResumeAnalysisJob): Promise<void> {
        await this.queue.send(job);
    }
}

class DurableObjectJdStore implements JobDescriptionStore {
    constructor(
        private readonly namespace: DurableObjectNamespace<JobDescriptionStoreObject>,
    ) {}

    async save(jd: JobDescription): Promise<JobDescription> {
        const result = await this.namespace.getByName(JD_STORE_NAME).create(jd);

        if (!result.ok) {
            throw new DuplicateJobDescriptionError(jd.id);
        }

        return result.jd;
    }

    async getById(id: string): Promise<JobDescription | undefined> {
        return this.namespace.getByName(JD_STORE_NAME).getById(id);
    }

    async listSummaries(): Promise<JobDescriptionSummary[]> {
        return this.namespace.getByName(JD_STORE_NAME).listSummaries();
    }

    async count(): Promise<number> {
        return this.namespace.getByName(JD_STORE_NAME).count();
    }
}

class WorkersAiExtractor implements AiExtractor {
    constructor(
        private readonly ai: Ai,
        private readonly gatewayId?: string,
        private readonly geminiResumeModel = DEFAULT_GEMINI_RESUME_MODEL,
    ) {}

    async extractResume(input: ResumeExtractionInput): Promise<ResumeAnalysis> {
        const markdown = await this.pdfToMarkdown(input);
        const response = await this.runGeminiResumePrompt(
            resumePrompt(input, markdown),
        );

        return parseResumeAnalysis(normalizeResumeAnalysis(response));
    }

    async analyzeJobDescription(rawText: string): Promise<JobDescription> {
        const response = await this.runJsonPrompt(
            JD_EXTRACTION_MODEL,
            "job-description",
            jdPrompt(rawText),
        );

        return normalizeJd(response, rawText);
    }

    private async runJsonPrompt(
        model: string,
        task: "job-description",
        content: string,
    ): Promise<unknown> {
        const startedAt = Date.now();
        const maxTokens = JD_EXTRACTION_MAX_TOKENS;
        let response: unknown;

        console.info("resume-ai", {
            event: "model:start",
            maxTokens,
            model,
            promptChars: content.length,
            task,
        });

        try {
            response = await this.ai.run(
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
                          gateway: {
                              cacheTtl: 3600,
                              id: this.gatewayId,
                              skipCache: false,
                          },
                      }
                    : undefined,
            );
        } catch (error) {
            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                error: errorMessage(error),
                event: "model:failed",
                model,
                task,
            });
            throw new Error(
                `${model} extraction failed: ${errorMessage(error)}`,
                {
                    cause: error,
                },
            );
        }

        console.info("resume-ai", {
            durationMs: elapsed(startedAt),
            event: "model:complete",
            model,
            response: describeAiResponse(response),
            task,
        });

        try {
            return parseAiJson(response);
        } catch (error) {
            const text = readAiText(response);

            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                error: errorMessage(error),
                event: "model:parse-failed",
                model,
                response: describeAiResponse(response),
                task,
                textChars: text.length,
                textPreview: previewText(text),
            });
            throw new Error(
                `${model} returned invalid JSON: ${errorMessage(error)}`,
                {
                    cause: error,
                },
            );
        }
    }

    private async runGeminiResumePrompt(content: string): Promise<unknown> {
        if (!this.gatewayId) {
            throw new Error(
                "AI Gateway name is required for resume extraction",
            );
        }

        const startedAt = Date.now();
        const endpoint = `v1beta/models/${this.geminiResumeModel}:generateContent`;
        let response: Response;

        console.info("resume-ai", {
            endpoint,
            event: "gateway:model:start",
            gatewayId: this.gatewayId,
            maxOutputTokens: GEMINI_RESUME_MAX_OUTPUT_TOKENS,
            model: this.geminiResumeModel,
            promptChars: content.length,
            provider: GOOGLE_AI_STUDIO_PROVIDER,
            task: "resume",
        });

        try {
            response = await this.ai.gateway(this.gatewayId).run(
                {
                    endpoint,
                    headers: {
                        "Content-Type": "application/json",
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
                    gateway: {
                        cacheTtl: 3600,
                        collectLog: true,
                        id: this.gatewayId,
                        skipCache: false,
                    },
                },
            );
        } catch (error) {
            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                endpoint,
                error: errorMessage(error),
                event: "gateway:model:failed",
                gatewayId: this.gatewayId,
                model: this.geminiResumeModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                task: "resume",
            });
            throw new Error(
                `${this.geminiResumeModel} extraction failed: ${errorMessage(error)}`,
                { cause: error },
            );
        }

        const responseText = await response.text();

        console.info("resume-ai", {
            durationMs: elapsed(startedAt),
            endpoint,
            event: "gateway:model:response",
            gatewayId: this.gatewayId,
            model: this.geminiResumeModel,
            provider: GOOGLE_AI_STUDIO_PROVIDER,
            responseChars: responseText.length,
            responsePreview: previewText(responseText),
            status: response.status,
            task: "resume",
        });

        if (!response.ok) {
            throw new Error(
                `${this.geminiResumeModel} extraction failed with HTTP ${response.status}: ${previewText(responseText)}`,
            );
        }

        try {
            const payload = JSON.parse(responseText) as unknown;
            const text = readGeminiText(payload);

            if (!text) {
                throw new Error("Gemini response did not include text content");
            }

            return parseAiJson(text);
        } catch (error) {
            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                endpoint,
                error: errorMessage(error),
                event: "gateway:model:parse-failed",
                gatewayId: this.gatewayId,
                model: this.geminiResumeModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                responseChars: responseText.length,
                responsePreview: previewText(responseText),
                task: "resume",
            });
            throw new Error(
                `${this.geminiResumeModel} returned invalid JSON: ${errorMessage(error)}`,
                { cause: error },
            );
        }
    }

    private async pdfToMarkdown(input: ResumeExtractionInput): Promise<string> {
        const startedAt = Date.now();
        let result: ConversionResponse;

        console.info("resume-ai", {
            bytes: input.bytes.byteLength,
            event: "markdown:start",
            fileName: input.fileName,
        });

        try {
            result = await this.ai.toMarkdown(
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
            );
        } catch (error) {
            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                error: errorMessage(error),
                event: "markdown:failed",
                fileName: input.fileName,
            });
            throw new Error(
                `PDF markdown conversion failed: ${errorMessage(error)}`,
                { cause: error },
            );
        }

        if (result.format === "error") {
            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                error: result.error,
                event: "markdown:error",
                fileName: input.fileName,
                format: result.format,
            });
            throw new Error(`PDF markdown conversion failed: ${result.error}`);
        }

        const markdown = compactResumeMarkdown(result.data);

        console.info("resume-ai", {
            compacted: markdown.length !== result.data.length,
            durationMs: elapsed(startedAt),
            event: "markdown:complete",
            fileName: input.fileName,
            markdownChars: markdown.length,
            originalMarkdownChars: result.data.length,
            tokens: result.tokens,
        });

        return markdown;
    }
}

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

function describeAiResponse(response: unknown): Record<string, unknown> {
    if (typeof response !== "object" || response === null) {
        return {
            type: typeof response,
        };
    }

    const record = response as Record<string, unknown>;
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const firstChoice = asRecord(choices[0]);
    const firstMessage = asRecord(firstChoice?.message);
    const firstMessageContent = firstMessage?.content;
    const firstMessageReasoning = asRecord(firstMessage?.reasoning);
    const result = asRecord(record.result);

    return {
        choiceCount: choices.length,
        contentArrayLength: Array.isArray(firstMessageContent)
            ? firstMessageContent.length
            : undefined,
        contentChars: stringLength(firstMessageContent),
        contentType:
            firstMessageContent === null || firstMessageContent === undefined
                ? firstMessageContent
                : Array.isArray(firstMessageContent)
                  ? "array"
                  : typeof firstMessageContent,
        finishReason: firstChoice?.finish_reason,
        keys: Object.keys(record).slice(0, 12),
        messageKeys: firstMessage
            ? Object.keys(firstMessage).slice(0, 12)
            : undefined,
        object: record.object,
        reasoningChars: stringLength(firstMessage?.reasoning_content),
        reasoningKeys: firstMessageReasoning
            ? Object.keys(firstMessageReasoning).slice(0, 12)
            : undefined,
        reasoningType:
            firstMessage?.reasoning === undefined
                ? undefined
                : typeof firstMessage.reasoning,
        responseChars: stringLength(record.response),
        resultKeys: result ? Object.keys(result).slice(0, 12) : undefined,
        resultType:
            record.result === undefined ? undefined : typeof record.result,
        stopReason: firstChoice?.stop_reason,
        textChars: stringLength(firstChoice?.text),
        type: "object",
        usage: record.usage,
    };
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

function stringLength(value: unknown): number | undefined {
    return typeof value === "string" ? value.length : undefined;
}

function previewText(text: string): string {
    return text.replace(/\s+/g, " ").slice(0, 320);
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

function elapsed(startedAt: number): number {
    return Date.now() - startedAt;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
