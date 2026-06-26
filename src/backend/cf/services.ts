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
import { createResumeId } from "../ids";
import { DuplicateJobDescriptionError } from "../ports";
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
    ResumeDocumentObject,
    ResumeRegistryObject,
} from "./durableObjects";

const JD_EXTRACTION_MODEL = "@cf/moonshotai/kimi-k2.6";
const DEFAULT_AI_GATEWAY_NAME = "collects-auto-ai";
const DEFAULT_GEMINI_RESUME_MODEL = "gemini-3.5-flash";
const GOOGLE_AI_STUDIO_PROVIDER = "google-ai-studio";
const MAX_RESUME_MARKDOWN_CHARS = 3_500;
const GEMINI_RESUME_MAX_OUTPUT_TOKENS = 4096;
const RESUME_SECTION_PATTERN =
    /(?:^|\n)(?:#{1,6}\s*)?(Education|Work Experience|Open-Source Contributions|Research Experience|Projects?|Skills)\b[^\n]*(?:\n[\s\S]*?)(?=\n(?:#{1,6}\s*)?(?:Education|Work Experience|Open-Source Contributions|Research Experience|Projects?|Skills)\b|$)/gi;
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
const RESUME_REGISTRY_NAME = "__resume_registry__";

export type CloudflareEnv = Env & {
    AI: Ai;
    AI_GATEWAY_NAME?: string;
    GEMINI_MODEL?: string;
    JD_INDEX: DurableObjectNamespace;
    JD_OBJECT: DurableObjectNamespace;
    RESUME_ANALYSIS_QUEUE: Queue<ResumeAnalysisJob>;
    RESUME_DOCUMENT: DurableObjectNamespace<ResumeDocumentObject>;
    RESUME_REGISTRY: DurableObjectNamespace<ResumeRegistryObject>;
};

export function createCloudflareServices(env: CloudflareEnv): AppServices {
    return {
        ai: new WorkersAiExtractor(
            env.AI,
            env.AI_GATEWAY_NAME ?? DEFAULT_AI_GATEWAY_NAME,
            env.GEMINI_MODEL ?? DEFAULT_GEMINI_RESUME_MODEL,
        ),
        jdStore: new DurableObjectJdStore(env.JD_OBJECT, env.JD_INDEX),
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
            resume,
        };

        await this.registryNamespace
            .getByName(RESUME_REGISTRY_NAME)
            .markReady(summarizeResume(resume, ready));
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

        return document?.status === "ready" ? document : undefined;
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
        private readonly objects: DurableObjectNamespace,
        private readonly index: DurableObjectNamespace,
    ) {}

    async save(jd: JobDescription): Promise<JobDescription> {
        if (await this.getById(jd.id)) {
            throw new DuplicateJobDescriptionError(jd.id);
        }

        await fetchDurable(this.objects, jd.id, {
            body: JSON.stringify(jd),
            method: "PUT",
        });
        await fetchDurable(this.index, "__jd_index__", {
            body: JSON.stringify({ id: jd.id }),
            method: "PUT",
        });

        return jd;
    }

    async getById(id: string): Promise<JobDescription | undefined> {
        const response = await fetchDurable(this.objects, id);

        if (response.status === 404) {
            return undefined;
        }

        const payload = (await response.json()) as {
            jd: JobDescription;
        };

        return payload.jd;
    }

    async listSummaries(): Promise<JobDescriptionSummary[]> {
        return (await this.list()).map((jd) => ({
            id: jd.id,
            tags: jd.tags,
            title: jd.title,
        }));
    }

    private async list(): Promise<JobDescription[]> {
        const index = await readIndex(this.index, "__jd_index__");
        const jds = await Promise.all(
            index.map(async (id) => this.getById(id)),
        );

        return jds.filter((jd): jd is JobDescription => Boolean(jd));
    }

    async count(): Promise<number> {
        return (await readIndex(this.index, "__jd_index__")).length;
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
            jdPrompt(rawText),
        );

        return normalizeJd(response, rawText);
    }

    private async runJsonPrompt(
        model: string,
        prompt: string,
    ): Promise<unknown> {
        const response = await this.ai.run(
            model,
            {
                messages: [
                    {
                        content:
                            "You extract hiring documents and return only valid JSON.",
                        role: "system",
                    },
                    {
                        content: prompt,
                        role: "user",
                    },
                ],
                response_format: {
                    type: "json_object",
                },
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

        return parseAiJson(response);
    }

    private async runGeminiResumePrompt(content: string): Promise<unknown> {
        if (!this.gatewayId) {
            throw new Error(
                "AI Gateway name is required for resume extraction",
            );
        }

        const response = await this.ai.gateway(this.gatewayId).run(
            {
                endpoint: `v1beta/models/${this.geminiResumeModel}:generateContent`,
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
        const responseText = await response.text();

        if (!response.ok) {
            throw new Error(
                `${this.geminiResumeModel} extraction failed with HTTP ${response.status}: ${previewText(responseText)}`,
            );
        }

        const payload = JSON.parse(responseText) as unknown;
        const text = readGeminiText(payload);

        if (!text) {
            throw new Error("Gemini response did not include text content");
        }

        return parseAiJson(text);
    }

    private async pdfToMarkdown(input: ResumeExtractionInput): Promise<string> {
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
            throw new Error(`PDF markdown conversion failed: ${result.error}`);
        }

        return compactResumeMarkdown(result.data);
    }
}

async function fetchDurable(
    namespace: DurableObjectNamespace,
    name: string,
    init?: RequestInit,
): Promise<Response> {
    const id = namespace.idFromName(name);
    const stub = namespace.get(id);

    return stub.fetch("https://durable-object.local/", {
        ...init,
        headers: {
            "content-type": "application/json",
            ...init?.headers,
        },
    });
}

async function readIndex(
    namespace: DurableObjectNamespace,
    name: string,
): Promise<string[]> {
    const response = await fetchDurable(namespace, name);
    const payload = (await response.json()) as { ids?: string[] };

    return payload.ids ?? [];
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
    const text = readAiText(response);
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced?.[1] ?? trimmed;

    return JSON.parse(jsonText);
}

function readAiText(response: unknown): string {
    if (typeof response === "string") {
        return response;
    }

    if (!response || typeof response !== "object") {
        return "{}";
    }

    const maybe = response as {
        choices?: Array<{ message?: { content?: string } }>;
        response?: string;
    };

    return maybe.response ?? maybe.choices?.[0]?.message?.content ?? "{}";
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

function compactResumeMarkdown(markdown: string): string {
    const normalized = markdown.replace(/\r\n/g, "\n").trim();

    if (normalized.length <= MAX_RESUME_MARKDOWN_CHARS) {
        return normalized;
    }

    const sections = [...normalized.matchAll(RESUME_SECTION_PATTERN)]
        .map((match) => match[0]?.trim() ?? "")
        .filter(Boolean);
    const compacted = sections.join("\n\n");

    return (compacted || normalized).slice(0, MAX_RESUME_MARKDOWN_CHARS);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    return buffer;
}

function previewText(text: string): string {
    return text.replace(/\s+/g, " ").slice(0, 320);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
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

            return typeof record?.text === "string" ? record.text : "";
        })
        .filter(Boolean);

    return parts.length > 0 ? parts.join("") : undefined;
}
