/* oxlint-disable no-await-in-loop -- fixture stream callbacks intentionally preserve token order. */
import type {
    AiExtractor,
    AppServices,
    JobDescriptionStore,
    PendingResumeUpload,
    ResumeAnalysisJob,
    ResumeExtractionInput,
    ResumeExtractionStreamCallbacks,
    ResumeAnalysisQueue,
    ResumeStore,
    ResumeUploadRecord,
} from "./ports";
import { DuplicateJobDescriptionError } from "./ports";
import { createResumeId } from "./ids";
import { normalizeResumeAnalysis } from "./normalization";
import type {
    JobDescription,
    JobDescriptionSummary,
    ResumeAnalysis,
    ResumeDocument,
    ResumeJdMatch,
    ResumeMetadata,
    ResumeSummary,
} from "../shared/types";
import { summarizeResume } from "../shared/types";
import { resumeAnalysisToFieldTokens } from "../shared/resumeStream";

const fixtureResume: ResumeAnalysis = {
    rawText:
        "Asuka\nasuka@example.com\nSenior frontend engineer with React and Cloudflare Workers experience.",
    basic: {
        name: "Asuka",
        email: "asuka@example.com",
        phone: "+1-555-0100",
        socialMedia: [{ name: "GitHub", link: "https://github.com/asuka" }],
    },
    edu: [
        {
            school: "National University",
            degree: "Master",
            awards: [{ name: "Dean List", value: "2021" }],
            experiences: [{ des: "Human-computer interaction research." }],
        },
    ],
    work: [
        {
            company: "Edge Apps",
            duration: ["2020-01-01", "2024-03-01"],
            type: "full-time",
            location: "hybrid",
            level: "senior",
            role: "Frontend Engineer",
            des: "Built resume analysis workflows with React and Workers.",
        },
    ],
    project: [
        {
            name: "Resume Analyzer",
            duration: ["2023-01-01", "2024-01-01"],
            type: "open-source",
            role: "maintainer",
            des: "AI-assisted resume parsing.",
        },
    ],
    skills: [
        { name: "React", des: "Frontend architecture" },
        { name: "Cloudflare Workers", des: "Edge APIs" },
        { name: "XState", des: "State machines" },
    ],
};

const fixtureJd: JobDescription = {
    id: "senior-frontend-engineer",
    title: "Senior Frontend Engineer",
    rawText:
        "Senior frontend engineer role requiring React, XState, Cloudflare Workers, and accessibility experience.",
    des: "Build accessible fullstack resume analysis product workflows.",
    tags: ["frontend", "cloudflare", "ai"],
    requiredSkills: ["React", "XState", "Cloudflare Workers"],
    requiredExperiences: ["5+ years frontend engineering", "Accessibility"],
};

const fixtureMatchDimensions: ResumeJdMatch["dimensions"] = [
    {
        dimension: "edu",
        label: "Edu",
        percentage: 80,
        rationale: "Master degree aligns with the role baseline.",
        score: 4,
    },
    {
        dimension: "project",
        label: "Project",
        percentage: 80,
        rationale: "Resume analyzer project is directly relevant.",
        score: 4,
    },
    {
        dimension: "work",
        label: "Work",
        percentage: 90,
        rationale: "Senior frontend work maps to the job scope.",
        score: 4.5,
    },
    {
        dimension: "skill",
        label: "Skill",
        percentage: 100,
        rationale: "React, XState, and Workers are present.",
        score: 5,
    },
    {
        dimension: "overall",
        label: "Overall",
        percentage: 90,
        rationale: "Strong frontend and edge platform fit.",
        score: 4.5,
    },
];

class MemoryResumeStore implements ResumeStore {
    readonly pending = new Map<string, PendingResumeUpload>();
    readonly records = new Map<string, ResumeDocument>();
    readonly summaries = new Map<string, ResumeSummary>();

    async archive(resumeId: string): Promise<ResumeSummary | undefined> {
        const existing = this.summaries.get(resumeId);

        if (!existing) {
            return undefined;
        }

        if (existing.status === "archived") {
            return existing;
        }

        const archivedAt = new Date().toISOString();
        const archivedSummary: ResumeSummary = {
            ...existing,
            archivedAt,
            status: "archived",
            updatedAt: archivedAt,
        };
        const document = this.records.get(resumeId);

        this.pending.delete(resumeId);
        this.summaries.set(resumeId, archivedSummary);

        if (document) {
            this.records.set(resumeId, {
                ...document,
                archivedAt,
                status: "archived",
                updatedAt: archivedAt,
            });
        }

        return archivedSummary;
    }

    async createPendingUpload(
        input: ResumeExtractionInput,
    ): Promise<ResumeUploadRecord> {
        const now = new Date().toISOString();
        const metadata: ResumeMetadata = {
            createdAt: now,
            resumeId: createResumeId(),
            status: "creating",
            updatedAt: now,
        };

        this.pending.set(metadata.resumeId, {
            ...metadata,
            bytes: new Uint8Array(input.bytes),
            fileName: input.fileName,
            source: input.source,
        });
        this.summaries.set(metadata.resumeId, {
            ...metadata,
            highestEducation: "Unknown",
            name: "",
            skills: [],
            workDuration: "Unknown",
        });

        return {
            ...metadata,
            bytes: input.bytes.byteLength,
            fileName: input.fileName,
            source: input.source,
        };
    }

    async completePendingAnalysis(
        resumeId: string,
        resume: ResumeAnalysis,
    ): Promise<ResumeDocument> {
        const normalizedResume = normalizeResumeAnalysis(resume);
        const pending = this.pending.get(resumeId);
        const now = new Date().toISOString();
        const createdAt = pending?.createdAt ?? now;
        const document: ResumeDocument = {
            createdAt,
            resume: normalizedResume,
            resumeId,
            status: "ready",
            updatedAt: now,
        };

        this.pending.delete(resumeId);
        this.records.set(document.resumeId, document);
        this.summaries.set(
            document.resumeId,
            summarizeResume(normalizedResume, document),
        );

        return document;
    }

    async failPendingAnalysis(resumeId: string): Promise<void> {
        const existing = this.summaries.get(resumeId);

        if (!existing) {
            return;
        }

        this.pending.delete(resumeId);
        this.summaries.set(resumeId, {
            ...existing,
            status: "failed",
            updatedAt: new Date().toISOString(),
        });
    }

    async getById(resumeId: string): Promise<ResumeDocument | undefined> {
        const document = this.records.get(resumeId);

        return document?.status === "ready" ? document : undefined;
    }

    async getPendingUpload(
        resumeId: string,
    ): Promise<PendingResumeUpload | undefined> {
        const pending = this.pending.get(resumeId);

        return pending
            ? { ...pending, bytes: new Uint8Array(pending.bytes) }
            : undefined;
    }

    async getSummary(resumeId: string): Promise<ResumeSummary | undefined> {
        return this.summaries.get(resumeId);
    }

    async listSummaries(): Promise<ResumeSummary[]> {
        return [...this.summaries.values()].filter(
            (summary) => summary.status === "ready",
        );
    }

    async count(): Promise<number> {
        return (await this.listSummaries()).length;
    }
}

class MemoryJdStore implements JobDescriptionStore {
    readonly records = new Map<
        string,
        { jd: JobDescription; updatedAt: string }
    >();

    async save(jd: JobDescription): Promise<JobDescription> {
        if (this.records.has(jd.id)) {
            throw new DuplicateJobDescriptionError(jd.id);
        }

        this.records.set(jd.id, {
            jd,
            updatedAt: new Date().toISOString(),
        });

        return jd;
    }

    async getById(id: string): Promise<JobDescription | undefined> {
        return this.records.get(id)?.jd;
    }

    async listSummaries(): Promise<JobDescriptionSummary[]> {
        return [...this.records.values()].map(({ jd, updatedAt }) => ({
            id: jd.id,
            tags: jd.tags,
            title: jd.title,
            updatedAt,
        }));
    }

    async count(): Promise<number> {
        return this.records.size;
    }
}

type TestServicesOptions = {
    jd?: JobDescription;
    match?: ResumeJdMatch;
    onExtractResume?: (input: ResumeExtractionInput) => void;
    resume?: ResumeAnalysis;
};

class TestAiExtractor implements AiExtractor {
    readonly calls = {
        resume: 0,
        jd: 0,
    };

    constructor(private readonly options: TestServicesOptions = {}) {}

    async extractResume(input: ResumeExtractionInput): Promise<ResumeAnalysis> {
        this.calls.resume += 1;
        this.options.onExtractResume?.(input);

        return this.options.resume ?? fixtureResume;
    }

    async extractResumeStream(
        input: ResumeExtractionInput,
        callbacks: ResumeExtractionStreamCallbacks,
    ): Promise<ResumeAnalysis> {
        await callbacks.onStatus?.({
            message: "Converting PDF to markdown",
            phase: "converting_pdf_to_markdown",
        });
        const resume = await this.extractResume(input);

        await callbacks.onStatus?.({
            message: "Extracting content from markdown",
            phase: "extracting_content_from_markdown",
        });

        for (const token of resumeAnalysisToFieldTokens(resume)) {
            await callbacks.onToken?.(token);
        }

        return resume;
    }

    async analyzeJobDescription(rawText: string): Promise<JobDescription> {
        this.calls.jd += 1;

        return {
            ...(this.options.jd ?? fixtureJd),
            rawText,
        };
    }

    async matchResumeToJobDescription(
        _jd: JobDescription,
        resume: ResumeDocument,
    ): Promise<ResumeJdMatch> {
        const fixture = this.options.match;

        return (
            fixture ?? {
                dimensions: fixtureMatchDimensions,
                intro: {
                    advantages:
                        "Advantages: strong React and Workers delivery evidence.",
                    disadvantages:
                        "Disadvantages: accessibility impact is lighter than requested.",
                },
                resumeId: resume.resumeId,
                resumeName: resume.resume.basic.name,
            }
        );
    }
}

class TestResumeAnalysisQueue implements ResumeAnalysisQueue {
    readonly jobs: ResumeAnalysisJob[] = [];

    async enqueue(job: ResumeAnalysisJob): Promise<void> {
        this.jobs.push(job);
    }
}

export function createTestServices(
    options: TestServicesOptions = {},
): AppServices & {
    ai: TestAiExtractor;
    jdStore: MemoryJdStore;
    resumeAnalysisQueue: TestResumeAnalysisQueue;
    resumeStore: MemoryResumeStore;
} {
    return {
        ai: new TestAiExtractor(options),
        jdStore: new MemoryJdStore(),
        resumeAnalysisQueue: new TestResumeAnalysisQueue(),
        resumeStore: new MemoryResumeStore(),
    };
}
