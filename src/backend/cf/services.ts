/* oxlint-disable no-await-in-loop -- stream readers and token callbacks must preserve chunk order. */
import type {
    AiExtractor,
    AppServices,
    JobDescriptionStore,
    PendingResumeUpload,
    ResumeAnalysisJob,
    ResumeAnalysisQueue,
    ResumeExtractionInput,
    ResumeExtractionStreamCallbacks,
    ResumeStore,
    ResumeUploadRecord,
} from "../ports";
import { DuplicateJobDescriptionError } from "../ports";
import { createResumeId } from "../ids";
import { normalizeResumeAnalysis } from "../normalization";
import { parseResumeAnalysis, parseResumeJdMatch } from "../../shared/schemas";
import type {
    JobDescription,
    JobDescriptionSummary,
    ResumeAnalysis,
    ResumeDocument,
    ResumeJdMatch,
    ResumeMetadata,
    ResumeSummary,
} from "../../shared/types";
import { summarizeResume } from "../../shared/types";
import {
    collectResumeFieldTokens,
    ResumeFieldTagParser,
    resumeFromTokenPatch,
    type ResumeFieldToken,
} from "../../shared/resumeStream";
import type {
    JobDescriptionStoreObject,
    ResumeDocumentObject,
    ResumeRegistryObject,
} from "./durableObjects";

const DEFAULT_AI_GATEWAY_NAME = "collects-auto-ai";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const GOOGLE_AI_STUDIO_PROVIDER = "google-ai-studio";
const MAX_RESUME_MARKDOWN_CHARS = 3_500;
const JD_EXTRACTION_MAX_TOKENS = 2048;
const JD_MATCH_MAX_TOKENS = 2048;
const MAX_MATCH_RESUME_CHARS = 6_000;
const GEMINI_RESUME_MAX_OUTPUT_TOKENS = 8192;
const RESUME_SECTION_PATTERN =
    /(?:^|\n)(?:#{1,6}\s*)?(Education|Work Experience|Open-Source Contributions|Research Experience|Projects?|Skills)\b[^\n]*(?:\n[\s\S]*?)(?=\n(?:#{1,6}\s*)?(?:Education|Work Experience|Open-Source Contributions|Research Experience|Projects?|Skills)\b|$)/gi;
const RESUME_REGISTRY_NAME = "__resume_registry__";
const JD_STORE_NAME = "__jd_store__";
const MATCH_DIMENSION_CONFIG = [
    { dimension: "edu", label: "Edu" },
    { dimension: "project", label: "Project" },
    { dimension: "work", label: "Work" },
    { dimension: "skill", label: "Skill" },
    { dimension: "overall", label: "Overall" },
] as const;

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
            env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
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
        private readonly geminiModel = DEFAULT_GEMINI_MODEL,
    ) {}

    async extractResume(input: ResumeExtractionInput): Promise<ResumeAnalysis> {
        return this.extractResumeStream(input, {});
    }

    async extractResumeStream(
        input: ResumeExtractionInput,
        callbacks: ResumeExtractionStreamCallbacks,
    ): Promise<ResumeAnalysis> {
        await callbacks.onStatus?.({
            message: "Converting PDF to markdown",
            phase: "converting_pdf_to_markdown",
        });
        const markdown = await this.pdfToMarkdown(input);
        await callbacks.onStatus?.({
            message: "Extracting content from markdown",
            phase: "extracting_content_from_markdown",
        });
        const tokens = await this.runGeminiResumeStreamPrompt(
            resumeStreamPrompt(input, markdown),
            callbacks,
        );
        const resume = resumeFromTokenPatch(collectResumeFieldTokens(tokens));

        return parseResumeAnalysis(normalizeResumeAnalysis(resume));
    }

    async analyzeJobDescription(rawText: string): Promise<JobDescription> {
        const response = await this.runGeminiJsonPrompt(
            "job-description",
            jdPrompt(rawText),
        );

        return normalizeJd(response, rawText);
    }

    async matchResumeToJobDescription(
        jd: JobDescription,
        resume: ResumeDocument,
    ): Promise<ResumeJdMatch> {
        const response = await this.runGeminiJsonPrompt(
            "resume-match",
            jdMatchPrompt(jd, resume),
        );

        return normalizeResumeJdMatch(response, resume);
    }

    private async runGeminiJsonPrompt(
        task: "job-description" | "resume-match",
        content: string,
    ): Promise<unknown> {
        if (!this.gatewayId) {
            throw new Error("AI Gateway name is required for Gemini analysis");
        }

        const startedAt = Date.now();
        const maxTokens =
            task === "resume-match"
                ? JD_MATCH_MAX_TOKENS
                : JD_EXTRACTION_MAX_TOKENS;
        const endpoint = `v1beta/models/${this.geminiModel}:generateContent`;
        let response: Response;
        let payload: unknown;

        console.info("resume-ai", {
            endpoint,
            event: "gateway:model:start",
            gatewayId: this.gatewayId,
            maxTokens,
            model: this.geminiModel,
            promptChars: content.length,
            provider: GOOGLE_AI_STUDIO_PROVIDER,
            task,
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
                                parts: [
                                    {
                                        text: `You analyze hiring documents and return only valid JSON. Do not include reasoning, explanations, or markdown.\n\n${content}`,
                                    },
                                ],
                                role: "user",
                            },
                        ],
                        generationConfig: {
                            maxOutputTokens: maxTokens,
                            responseMimeType: "application/json",
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
                model: this.geminiModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                task,
            });
            throw new Error(
                `${this.geminiModel} ${task} failed: ${errorMessage(error)}`,
                {
                    cause: error,
                },
            );
        }

        if (!response.ok) {
            const responseText = await response.text();

            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                endpoint,
                event: "gateway:model:http-failed",
                gatewayId: this.gatewayId,
                model: this.geminiModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                responseStatus: response.status,
                responseText: previewText(responseText),
                task,
            });
            throw new Error(
                `${this.geminiModel} ${task} failed with HTTP ${response.status}: ${previewText(responseText)}`,
            );
        }

        try {
            payload = await response.json();
        } catch (error) {
            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                endpoint,
                error: errorMessage(error),
                event: "gateway:model:invalid-response",
                gatewayId: this.gatewayId,
                model: this.geminiModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                task,
            });
            throw new Error(
                `${this.geminiModel} ${task} returned an invalid response: ${errorMessage(error)}`,
                {
                    cause: error,
                },
            );
        }

        console.info("resume-ai", {
            durationMs: elapsed(startedAt),
            endpoint,
            event: "gateway:model:complete",
            gatewayId: this.gatewayId,
            model: this.geminiModel,
            provider: GOOGLE_AI_STUDIO_PROVIDER,
            response: describeAiResponse(payload),
            task,
        });

        try {
            return parseAiJson(payload);
        } catch (error) {
            const text = readAiText(payload);

            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                endpoint,
                error: errorMessage(error),
                event: "gateway:model:parse-failed",
                gatewayId: this.gatewayId,
                model: this.geminiModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                response: describeAiResponse(payload),
                task,
                textChars: text.length,
                textPreview: previewText(text),
            });
            throw new Error(
                `${this.geminiModel} returned invalid JSON: ${errorMessage(error)}`,
                {
                    cause: error,
                },
            );
        }
    }

    private async runGeminiResumeStreamPrompt(
        content: string,
        callbacks: ResumeExtractionStreamCallbacks,
    ): Promise<ResumeFieldToken[]> {
        if (!this.gatewayId) {
            throw new Error(
                "AI Gateway name is required for resume extraction",
            );
        }

        const startedAt = Date.now();
        const endpoint = `v1beta/models/${this.geminiModel}:streamGenerateContent?alt=sse`;
        const parser = new ResumeFieldTagParser();
        const tokens: ResumeFieldToken[] = [];
        let chunkCount = 0;
        let tokenCount = 0;
        let response: Response;

        console.info("resume-ai", {
            endpoint,
            event: "gateway:model:stream:start",
            gatewayId: this.gatewayId,
            maxOutputTokens: GEMINI_RESUME_MAX_OUTPUT_TOKENS,
            model: this.geminiModel,
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
                            temperature: 0,
                        },
                    },
                },
                {
                    gateway: {
                        cacheTtl: 0,
                        collectLog: true,
                        id: this.gatewayId,
                        skipCache: true,
                    },
                },
            );
        } catch (error) {
            console.error("resume-ai", {
                durationMs: elapsed(startedAt),
                endpoint,
                error: errorMessage(error),
                event: "gateway:model:stream:failed",
                gatewayId: this.gatewayId,
                model: this.geminiModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                task: "resume",
            });
            throw new Error(
                `${this.geminiModel} stream extraction failed: ${errorMessage(error)}`,
                { cause: error },
            );
        }

        if (!response.ok) {
            const responseText = await response.text();

            throw new Error(
                `${this.geminiModel} stream extraction failed with HTTP ${response.status}: ${previewText(responseText)}`,
            );
        }

        try {
            await readGeminiSseText(response, async (text) => {
                chunkCount += 1;

                for (const token of parser.push(text)) {
                    tokenCount += 1;
                    tokens.push(token);
                    await callbacks.onToken?.(token);
                }
            });
            parser.flush();
        } catch (error) {
            console.error("resume-ai", {
                chunkCount,
                durationMs: elapsed(startedAt),
                endpoint,
                error: errorMessage(error),
                event: "gateway:model:stream:parse-failed",
                gatewayId: this.gatewayId,
                model: this.geminiModel,
                provider: GOOGLE_AI_STUDIO_PROVIDER,
                task: "resume",
                tokenCount,
            });
            throw new Error(
                `${this.geminiModel} returned an invalid resume stream: ${errorMessage(error)}`,
                { cause: error },
            );
        }

        if (tokens.length === 0) {
            throw new Error(
                `${this.geminiModel} returned no complete resume field tags`,
            );
        }

        console.info("resume-ai", {
            chunkCount,
            durationMs: elapsed(startedAt),
            endpoint,
            event: "gateway:model:stream:complete",
            gatewayId: this.gatewayId,
            model: this.geminiModel,
            provider: GOOGLE_AI_STUDIO_PROVIDER,
            task: "resume",
            tokenCount,
        });

        return tokens;
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
            // TODO(markdown-stream): If toMarkdown exposes streaming output later,
            // forward converted PDF text chunks into resume extraction as they arrive.
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

function resumeStreamPrompt(
    input: ResumeExtractionInput,
    markdown: string,
): string {
    return `Extract this PDF resume text into flat XML-style field tags for streaming display.
Return only tags. Do not return JSON, markdown fences, comments, explanations, or binary content.
Each complete tag must be independent and use the same opening and closing path:
<basic.name>Asuka</basic.name>
<edu.0.school>National University</edu.0.school>
<work.0.duration.0>2020-01-01</work.0.duration.0>

Use zero-based numeric path segments for arrays. Numeric segments create array items.
Allowed top-level paths: rawText, basic, edu, work, project, skills.
Use these fields:
- rawText
- basic.name, basic.email, basic.phone, basic.socialMedia.N.name, basic.socialMedia.N.link
- edu.N.school, edu.N.degree, edu.N.awards.N.name, edu.N.awards.N.value, edu.N.experiences.N.des
- work.N.company, work.N.duration.N, work.N.type, work.N.location, work.N.level, work.N.role, work.N.des
- project.N.name, project.N.duration.N, project.N.type, project.N.role, project.N.des
- skills.N.name, skills.N.des

Rules:
- Prefer concise values. Keep rawText under 600 chars and descriptions under 180 chars.
- Use ISO-like dates for duration values when possible.
- For work.type use only intern or full-time. Omit it if unknown.
- For work.location use only hybrid, remote, or on-site. Omit it if unknown.
- For project.type use only open-source or hobby. Omit it if unknown.
- For project.role use only maintainer, contributor, or owner. Omit it if unknown.
- Escape literal <, >, &, ", and ' inside values as XML entities.
- Emit each known value exactly once.

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

function jdMatchPrompt(jd: JobDescription, resume: ResumeDocument): string {
    return `Match this resume against the job description and return only valid JSON.
Return this exact shape:
{
  "dimensions": [
    {"dimension": "edu", "label": "Edu", "score": 0-5, "percentage": 0-100, "rationale": "string <=120 chars"},
    {"dimension": "project", "label": "Project", "score": 0-5, "percentage": 0-100, "rationale": "string <=120 chars"},
    {"dimension": "work", "label": "Work", "score": 0-5, "percentage": 0-100, "rationale": "string <=120 chars"},
    {"dimension": "skill", "label": "Skill", "score": 0-5, "percentage": 0-100, "rationale": "string <=120 chars"},
    {"dimension": "overall", "label": "Overall", "score": 0-5, "percentage": 0-100, "rationale": "string <=120 chars"}
  ],
  "intro": {"advantages": "string <=140 chars", "disadvantages": "string <=140 chars"}
}
Rules:
- Include exactly the five dimensions listed above.
- Score is the chart value from 0 to 5. Percentage must equal score / 5 * 100 rounded to a whole number.
- Judge only from evidence in the resume and the job description.
- Keep intro as one brief advantage and one brief disadvantage.
Job description:
${JSON.stringify(jd)}
Resume:
${compactJson(resume.resume, MAX_MATCH_RESUME_CHARS)}`;
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

    const geminiText = readGeminiText(record);

    if (geminiText) {
        return geminiText;
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

async function readGeminiSseText(
    response: Response,
    onText: (text: string) => Promise<void>,
): Promise<void> {
    const reader = response.body?.getReader();

    if (!reader) {
        await readNonSseGeminiText(await response.text(), onText);
        return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let rawText = "";
    let eventCount = 0;

    while (true) {
        const { done, value } = await reader.read();
        const text = decoder.decode(value, { stream: !done });

        rawText += text;
        buffer = normalizeLineEndings(buffer + text);

        let separatorIndex = buffer.indexOf("\n\n");

        while (separatorIndex >= 0) {
            const rawEvent = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            eventCount += await readGeminiSseEvent(rawEvent, onText);
            separatorIndex = buffer.indexOf("\n\n");
        }

        if (done) {
            break;
        }
    }

    if (buffer.trim()) {
        eventCount += await readGeminiSseEvent(buffer, onText);
    }

    if (eventCount === 0 && rawText.trim()) {
        await readNonSseGeminiText(rawText, onText);
    }
}

async function readGeminiSseEvent(
    rawEvent: string,
    onText: (text: string) => Promise<void>,
): Promise<number> {
    const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n")
        .trim();

    if (!data) {
        return 0;
    }

    if (data === "[DONE]") {
        return 1;
    }

    const payload = JSON.parse(data) as unknown;
    const text = readGeminiText(payload);

    if (text) {
        await onText(text);
    }

    return 1;
}

async function readNonSseGeminiText(
    rawText: string,
    onText: (text: string) => Promise<void>,
): Promise<void> {
    const trimmed = rawText.trim();

    if (!trimmed) {
        return;
    }

    try {
        const payload = JSON.parse(trimmed) as unknown;
        const values = Array.isArray(payload) ? payload : [payload];

        for (const value of values) {
            const text = readGeminiText(value);

            if (text) {
                await onText(text);
            }
        }
    } catch {
        await onText(trimmed);
    }
}

function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
            "requiredExperiences" in record) ||
        ("dimensions" in record && "intro" in record)
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
    const candidates = Array.isArray(record.candidates)
        ? record.candidates
        : [];
    const firstChoice = asRecord(choices[0]);
    const firstMessage = asRecord(firstChoice?.message);
    const firstMessageContent = firstMessage?.content;
    const firstMessageReasoning = asRecord(firstMessage?.reasoning);
    const geminiText = readGeminiText(record);
    const result = asRecord(record.result);

    return {
        candidateCount: candidates.length,
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
        geminiTextChars: stringLength(geminiText),
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

function normalizeResumeJdMatch(
    data: unknown,
    resume: ResumeDocument,
): ResumeJdMatch {
    const value = asRecord(data) ?? {};
    const dimensionsValue = Array.isArray(value.dimensions)
        ? value.dimensions
        : Array.isArray(value.scores)
          ? value.scores
          : [];
    const intro = asRecord(value.intro);
    const normalized: ResumeJdMatch = {
        dimensions: MATCH_DIMENSION_CONFIG.map((config) =>
            normalizeMatchDimension(config, dimensionsValue),
        ),
        intro: {
            advantages: compactOneLine(
                readString(intro?.advantages) ??
                    readString(value.advantages) ??
                    "Relevant strengths require human review.",
                180,
            ),
            disadvantages: compactOneLine(
                readString(intro?.disadvantages) ??
                    readString(value.disadvantages) ??
                    "Potential gaps require human review.",
                180,
            ),
        },
        resumeId: resume.resumeId,
        resumeName: resume.resume.basic.name || "Unknown",
    };

    return parseResumeJdMatch(normalized);
}

function normalizeMatchDimension(
    config: (typeof MATCH_DIMENSION_CONFIG)[number],
    dimensions: unknown[],
): ResumeJdMatch["dimensions"][number] {
    const source: Record<string, unknown> =
        dimensions
            .map((dimension) => asRecord(dimension))
            .find(
                (dimension) =>
                    normalizeDimensionName(
                        readString(dimension?.dimension) ??
                            readString(dimension?.label) ??
                            "",
                    ) === config.dimension,
            ) ?? {};
    const rawPercentage =
        readFiniteNumber(source.percentage) ??
        readFiniteNumber(source.matchPercentage);
    const rawScore =
        readFiniteNumber(source.score) ??
        (rawPercentage === undefined ? 0 : rawPercentage / 20);
    const score = roundToTenth(clamp(rawScore, 0, 5));
    const percentage = Math.round(clamp(rawPercentage ?? score * 20, 0, 100));

    return {
        dimension: config.dimension,
        label: config.label,
        percentage,
        rationale: compactOneLine(
            readString(source.rationale) ??
                readString(source.reason) ??
                "No model rationale returned.",
            140,
        ),
        score,
    };
}

function normalizeDimensionName(
    value: string,
): ResumeJdMatch["dimensions"][number]["dimension"] | "" {
    const normalized = value.toLowerCase().replace(/[^a-z]/g, "");

    if (normalized === "education" || normalized === "edu") {
        return "edu";
    }

    if (normalized === "projects" || normalized === "project") {
        return "project";
    }

    if (normalized === "work" || normalized === "experience") {
        return "work";
    }

    if (normalized === "skills" || normalized === "skill") {
        return "skill";
    }

    if (normalized === "overall") {
        return "overall";
    }

    return "";
}

function readFiniteNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);

        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function roundToTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

function compactOneLine(value: string, maxChars: number): string {
    const compacted = value.replace(/\s+/g, " ").trim();

    return compacted.length <= maxChars
        ? compacted
        : compacted.slice(0, maxChars).trimEnd();
}

function compactJson(value: unknown, maxChars: number): string {
    const json = JSON.stringify(value);

    return json.length <= maxChars ? json : json.slice(0, maxChars);
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
