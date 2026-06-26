import type {
    AiExtractor,
    AppServices,
    JobDescriptionStore,
    ResumeStore,
} from "./ports";
import { DuplicateJobDescriptionError } from "./ports";
import type {
    JobDescription,
    JobDescriptionSummary,
    ResumeAnalysis,
} from "../shared/types";
import { resumeWriterKey } from "../shared/types";

const fixtureResume: ResumeAnalysis = {
    rawText:
        "Ava Chen\nava@example.com\nSenior frontend engineer with React and Cloudflare Workers experience.",
    basic: {
        name: "Ava Chen",
        email: "ava@example.com",
        phone: "+1-555-0100",
        socialMedia: [{ name: "GitHub", link: "https://github.com/ava" }],
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

class MemoryResumeStore implements ResumeStore {
    readonly records = new Map<string, ResumeAnalysis>();

    async save(resume: ResumeAnalysis): Promise<void> {
        this.records.set(resumeWriterKey(resume.basic.name), resume);
    }

    async getByName(name: string): Promise<ResumeAnalysis | undefined> {
        return this.records.get(resumeWriterKey(name));
    }

    async list(): Promise<ResumeAnalysis[]> {
        return [...this.records.values()];
    }

    async count(): Promise<number> {
        return this.records.size;
    }
}

class MemoryJdStore implements JobDescriptionStore {
    readonly records = new Map<string, JobDescription>();

    async save(jd: JobDescription): Promise<JobDescription> {
        if (this.records.has(jd.id)) {
            throw new DuplicateJobDescriptionError(jd.id);
        }

        this.records.set(jd.id, jd);

        return jd;
    }

    async getById(id: string): Promise<JobDescription | undefined> {
        return this.records.get(id);
    }

    async listSummaries(): Promise<JobDescriptionSummary[]> {
        return [...this.records.values()].map((jd) => ({
            id: jd.id,
            tags: jd.tags,
            title: jd.title,
        }));
    }

    async count(): Promise<number> {
        return this.records.size;
    }
}

class TestAiExtractor implements AiExtractor {
    readonly calls = {
        resume: 0,
        jd: 0,
    };

    async extractResume(): Promise<ResumeAnalysis> {
        this.calls.resume += 1;

        return fixtureResume;
    }

    async analyzeJobDescription(rawText: string): Promise<JobDescription> {
        this.calls.jd += 1;

        return {
            ...fixtureJd,
            rawText,
        };
    }
}

export function createTestServices(): AppServices & {
    ai: TestAiExtractor;
    jdStore: MemoryJdStore;
    resumeStore: MemoryResumeStore;
} {
    return {
        ai: new TestAiExtractor(),
        jdStore: new MemoryJdStore(),
        resumeStore: new MemoryResumeStore(),
    };
}
