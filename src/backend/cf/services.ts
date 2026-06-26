import type {
    AiExtractor,
    AppServices,
    JobDescriptionStore,
    ResumeExtractionInput,
    ResumeStore,
} from "../ports";
import {
    contextMetadata,
    durationMs,
    gatewayMetadata,
    logError,
    logInfo,
    requestHeaders,
    sha256Hex,
    type ObservabilityContext,
} from "../observability";
import type { JobDescription, ResumeAnalysis } from "../../shared/types";
import { resumeWriterKey } from "../../shared/types";

const KIMI_MODEL = "@cf/moonshotai/kimi-k2.6";

export type CloudflareEnv = Env & {
    AI: Ai;
    AI_GATEWAY_ID?: string;
    AI_GATEWAY_NAME?: string;
    JD_INDEX: DurableObjectNamespace;
    JD_OBJECT: DurableObjectNamespace;
    RESUME_INDEX: DurableObjectNamespace;
    RESUME_OBJECT: DurableObjectNamespace;
};

export function createCloudflareServices(env: CloudflareEnv): AppServices {
    const aiGatewayId = env.AI_GATEWAY_ID ?? env.AI_GATEWAY_NAME;

    return {
        ai: new WorkersAiExtractor(env.AI, aiGatewayId),
        jdStore: new DurableObjectJdStore(env.JD_OBJECT, env.JD_INDEX),
        resumeStore: new DurableObjectResumeStore(
            env.RESUME_OBJECT,
            env.RESUME_INDEX,
        ),
    };
}

class DurableObjectResumeStore implements ResumeStore {
    constructor(
        private readonly objects: DurableObjectNamespace,
        private readonly index: DurableObjectNamespace,
    ) {}

    async save(
        resume: ResumeAnalysis,
        context?: ObservabilityContext,
    ): Promise<void> {
        const name = resumeWriterKey(resume.basic.name);
        const nameHash = await sha256Hex(name);
        const startedAt = Date.now();

        logInfo(
            "resume.store.save.start",
            contextMetadata(context, {
                resume_name_sha256: nameHash,
            }),
        );

        await fetchDurable(
            this.objects,
            name,
            {
                body: JSON.stringify(resume),
                method: "PUT",
            },
            context,
            "resume.object.put",
        );
        await fetchDurable(
            this.index,
            "__resume_index__",
            {
                body: JSON.stringify({ name }),
                method: "PUT",
            },
            context,
            "resume.index.put",
        );

        logInfo(
            "resume.store.save.complete",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                resume_name_sha256: nameHash,
            }),
        );
    }

    async getByName(
        name: string,
        context?: ObservabilityContext,
    ): Promise<ResumeAnalysis | undefined> {
        const response = await fetchDurable(
            this.objects,
            resumeWriterKey(name),
            undefined,
            context,
            "resume.object.get",
        );

        if (response.status === 404) {
            return undefined;
        }

        const payload = (await response.json()) as { resume: ResumeAnalysis };

        return payload.resume;
    }

    async list(context?: ObservabilityContext): Promise<ResumeAnalysis[]> {
        const index = await readIndex(
            this.index,
            "__resume_index__",
            context,
            "resume.index.list",
        );
        const resumes = await Promise.all(
            index.map((name) => this.getByName(name, context)),
        );

        return resumes.filter((resume): resume is ResumeAnalysis =>
            Boolean(resume),
        );
    }

    async count(context?: ObservabilityContext): Promise<number> {
        return (
            await readIndex(
                this.index,
                "__resume_index__",
                context,
                "resume.index.count",
            )
        ).length;
    }
}

class DurableObjectJdStore implements JobDescriptionStore {
    constructor(
        private readonly objects: DurableObjectNamespace,
        private readonly index: DurableObjectNamespace,
    ) {}

    async save(
        jd: JobDescription,
        context?: ObservabilityContext,
    ): Promise<void> {
        const idHash = await sha256Hex(jd.id);
        const startedAt = Date.now();

        logInfo(
            "jd.store.save.start",
            contextMetadata(context, {
                jd_id_sha256: idHash,
            }),
        );

        await fetchDurable(
            this.objects,
            jd.id,
            {
                body: JSON.stringify(jd),
                method: "PUT",
            },
            context,
            "jd.object.put",
        );
        await fetchDurable(
            this.index,
            "__jd_index__",
            {
                body: JSON.stringify({ id: jd.id }),
                method: "PUT",
            },
            context,
            "jd.index.put",
        );

        logInfo(
            "jd.store.save.complete",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                jd_id_sha256: idHash,
            }),
        );
    }

    async list(context?: ObservabilityContext): Promise<JobDescription[]> {
        const index = await readIndex(
            this.index,
            "__jd_index__",
            context,
            "jd.index.list",
        );
        const jds = await Promise.all(
            index.map(async (id) => {
                const response = await fetchDurable(
                    this.objects,
                    id,
                    undefined,
                    context,
                    "jd.object.get",
                );

                if (response.status === 404) {
                    return undefined;
                }

                const payload = (await response.json()) as {
                    jd: JobDescription;
                };

                return payload.jd;
            }),
        );

        return jds.filter((jd): jd is JobDescription => Boolean(jd));
    }

    async count(context?: ObservabilityContext): Promise<number> {
        return (
            await readIndex(
                this.index,
                "__jd_index__",
                context,
                "jd.index.count",
            )
        ).length;
    }
}

class WorkersAiExtractor implements AiExtractor {
    constructor(
        private readonly ai: Ai,
        private readonly gatewayId?: string,
    ) {}

    async extractResume(
        input: ResumeExtractionInput,
        context?: ObservabilityContext,
    ): Promise<ResumeAnalysis> {
        const response = await this.runJsonPrompt(resumePrompt(input), {
            context,
            inputBytes: input.bytes.byteLength,
            inputChars: undefined,
            inputKind: "resume_pdf",
            inputSha256: await sha256Hex(input.bytes),
            task: "resume_extract",
            uploadSource: input.source,
        });

        return normalizeResume(response);
    }

    async analyzeJobDescription(
        rawText: string,
        context?: ObservabilityContext,
    ): Promise<JobDescription> {
        const response = await this.runJsonPrompt(jdPrompt(rawText), {
            context,
            inputBytes: undefined,
            inputChars: rawText.length,
            inputKind: "job_description_text",
            inputSha256: await sha256Hex(rawText),
            task: "jd_extract",
            uploadSource: undefined,
        });

        return normalizeJd(response, rawText);
    }

    private async runJsonPrompt(
        prompt: string,
        metadata: AiRequestMetadata,
    ): Promise<unknown> {
        const startedAt = Date.now();
        const eventId = metadata.context?.requestId ?? crypto.randomUUID();
        const logMetadata = contextMetadata(metadata.context, {
            ai_gateway_enabled: Boolean(this.gatewayId),
            gateway_event_id: eventId,
            input_bytes: metadata.inputBytes,
            input_chars: metadata.inputChars,
            input_kind: metadata.inputKind,
            input_sha256: metadata.inputSha256,
            model: KIMI_MODEL,
            prompt_chars: prompt.length,
            task: metadata.task,
            upload_source: metadata.uploadSource,
        });

        logInfo("ai.request.start", logMetadata);

        try {
            const response = await this.ai.run(
                KIMI_MODEL,
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
            const parsed = parseAiJson(response);

            logInfo(
                "ai.request.complete",
                contextMetadata(metadata.context, {
                    duration_ms: durationMs(startedAt),
                    gateway_event_id: eventId,
                    model: KIMI_MODEL,
                    response_chars: readAiText(response).length,
                    task: metadata.task,
                }),
            );

            return parsed;
        } catch (error) {
            logError(
                "ai.request.failed",
                contextMetadata(metadata.context, {
                    duration_ms: durationMs(startedAt),
                    gateway_event_id: eventId,
                    model: KIMI_MODEL,
                    task: metadata.task,
                }),
                error,
            );
            throw error;
        }
    }
}

type AiRequestMetadata = {
    context?: ObservabilityContext;
    inputBytes?: number;
    inputChars?: number;
    inputKind: string;
    inputSha256: string;
    task: string;
    uploadSource?: string;
};

async function fetchDurable(
    namespace: DurableObjectNamespace,
    name: string,
    init?: RequestInit,
    context?: ObservabilityContext,
    operation = "durable.fetch",
): Promise<Response> {
    const startedAt = Date.now();
    const id = namespace.idFromName(name);
    const stub = namespace.get(id);
    const headers = new Headers(init?.headers);
    const durableHeaders = requestHeaders(context, operation);
    const nameHash = await sha256Hex(name);

    headers.set("content-type", "application/json");
    durableHeaders.forEach((value, key) => {
        headers.set(key, value);
    });

    logInfo(
        "durable.fetch.start",
        contextMetadata(context, {
            durable_method: init?.method ?? "GET",
            durable_name_sha256: nameHash,
            durable_operation: operation,
        }),
    );

    try {
        const response = await stub.fetch("https://durable-object.local/", {
            ...init,
            headers,
        });

        logInfo(
            "durable.fetch.complete",
            contextMetadata(context, {
                durable_method: init?.method ?? "GET",
                durable_name_sha256: nameHash,
                durable_operation: operation,
                duration_ms: durationMs(startedAt),
                status_code: response.status,
            }),
        );

        return response;
    } catch (error) {
        logError(
            "durable.fetch.failed",
            contextMetadata(context, {
                durable_method: init?.method ?? "GET",
                durable_name_sha256: nameHash,
                durable_operation: operation,
                duration_ms: durationMs(startedAt),
            }),
            error,
        );
        throw error;
    }
}

async function readIndex(
    namespace: DurableObjectNamespace,
    name: string,
    context?: ObservabilityContext,
    operation = "durable.index.read",
): Promise<string[]> {
    const response = await fetchDurable(
        namespace,
        name,
        undefined,
        context,
        operation,
    );
    const payload = (await response.json()) as { ids?: string[] };

    return payload.ids ?? [];
}

function resumePrompt(input: ResumeExtractionInput): string {
    return `Extract this PDF resume into JSON with keys rawText, basic, edu, work, project, skills.
Schema:
{
  "rawText": "string",
  "basic": {"name": "string", "email": "string", "phone": "string", "socialMedia": [{"name": "string", "link": "string"}]},
  "edu": [{"school": "string", "degree": "string", "awards": [{"name": "string", "value": "string"}], "experiences": [{"des": "string"}]}],
  "work": [{"company": "string", "duration": ["ISO date"], "type": "intern|full-time", "location": "hybrid|remote|on-site", "level": "string", "role": "string", "des": "string"}],
  "project": [{"name": "string", "duration": ["ISO date"], "type": "open-source|hobby", "role": "maintainer|contributor|owner", "des": "string"}],
  "skills": [{"name": "string", "des": "string"}]
}
Missing fields must become empty strings or empty arrays.
File name: ${input.fileName}
Upload source: ${input.source}
PDF bytes as base64:
${bytesToBase64(input.bytes)}`;
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

function normalizeResume(data: unknown): ResumeAnalysis {
    const value = data as Partial<ResumeAnalysis>;

    return {
        basic: {
            email: value.basic?.email ?? "",
            name: value.basic?.name?.trim() || "Unknown",
            phone: value.basic?.phone ?? "",
            socialMedia: value.basic?.socialMedia ?? [],
        },
        edu: value.edu ?? [],
        project: value.project ?? [],
        rawText: value.rawText ?? "",
        skills: value.skills ?? [],
        work: value.work ?? [],
    };
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

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.slice(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}
