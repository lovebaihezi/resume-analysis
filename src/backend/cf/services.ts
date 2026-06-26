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
import type {
    JobDescription,
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

const KIMI_MODEL = "@cf/moonshotai/kimi-k2.6";
const RESUME_REGISTRY_NAME = "__resume_registry__";

export type CloudflareEnv = Env & {
    AI: Ai;
    AI_GATEWAY_NAME?: string;
    JD_INDEX: DurableObjectNamespace;
    JD_OBJECT: DurableObjectNamespace;
    RESUME_ANALYSIS_QUEUE: Queue<ResumeAnalysisJob>;
    RESUME_DOCUMENT: DurableObjectNamespace<ResumeDocumentObject>;
    RESUME_REGISTRY: DurableObjectNamespace<ResumeRegistryObject>;
};

export function createCloudflareServices(env: CloudflareEnv): AppServices {
    return {
        ai: new WorkersAiExtractor(env.AI, env.AI_GATEWAY_NAME),
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

    async save(jd: JobDescription): Promise<void> {
        await fetchDurable(this.objects, jd.id, {
            body: JSON.stringify(jd),
            method: "PUT",
        });
        await fetchDurable(this.index, "__jd_index__", {
            body: JSON.stringify({ id: jd.id }),
            method: "PUT",
        });
    }

    async list(): Promise<JobDescription[]> {
        const index = await readIndex(this.index, "__jd_index__");
        const jds = await Promise.all(
            index.map(async (id) => {
                const response = await fetchDurable(this.objects, id);

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

    async count(): Promise<number> {
        return (await readIndex(this.index, "__jd_index__")).length;
    }
}

class WorkersAiExtractor implements AiExtractor {
    constructor(
        private readonly ai: Ai,
        private readonly gatewayId?: string,
    ) {}

    async extractResume(input: ResumeExtractionInput): Promise<ResumeAnalysis> {
        const response = await this.runJsonPrompt(resumePrompt(input));

        return normalizeResume(response);
    }

    async analyzeJobDescription(rawText: string): Promise<JobDescription> {
        const response = await this.runJsonPrompt(jdPrompt(rawText));

        return normalizeJd(response, rawText);
    }

    private async runJsonPrompt(prompt: string): Promise<unknown> {
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
