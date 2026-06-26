import type {
    JobDescription,
    JobDescriptionSummary,
    ResumeAnalysis,
    UploadSource,
} from "../shared/types";

export type ResumeExtractionInput = {
    fileName: string;
    bytes: Uint8Array;
    source: UploadSource;
};

export interface ResumeStore {
    save(resume: ResumeAnalysis): Promise<void>;
    getByName(name: string): Promise<ResumeAnalysis | undefined>;
    list(): Promise<ResumeAnalysis[]>;
    count(): Promise<number>;
}

export interface JobDescriptionStore {
    save(jd: JobDescription): Promise<JobDescription>;
    getById(id: string): Promise<JobDescription | undefined>;
    listSummaries(): Promise<JobDescriptionSummary[]>;
    count(): Promise<number>;
}

export interface AiExtractor {
    extractResume(input: ResumeExtractionInput): Promise<ResumeAnalysis>;
    analyzeJobDescription(rawText: string): Promise<JobDescription>;
}

export type AppServices = {
    resumeStore: ResumeStore;
    jdStore: JobDescriptionStore;
    ai: AiExtractor;
};

export class DuplicateJobDescriptionError extends Error {
    constructor(id: string) {
        super(`Job description already exists: ${id}`);
        this.name = "DuplicateJobDescriptionError";
    }
}
