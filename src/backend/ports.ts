import type {
    JobDescription,
    JobDescriptionSummary,
    ResumeAnalysis,
    ResumeDocument,
    ResumeMetadata,
    UploadSource,
    ResumeSummary,
} from "../shared/types";

export type ResumeExtractionInput = {
    fileName: string;
    bytes: Uint8Array;
    source: UploadSource;
};

export type PendingResumeUpload = ResumeMetadata & ResumeExtractionInput;

export type ResumeUploadRecord = ResumeMetadata & {
    bytes: number;
    fileName: string;
    source: UploadSource;
};

export type ResumeAnalysisJob = {
    resumeId: string;
};

export interface ResumeStore {
    archive(resumeId: string): Promise<ResumeSummary | undefined>;
    completePendingAnalysis(
        resumeId: string,
        resume: ResumeAnalysis,
    ): Promise<ResumeDocument>;
    createPendingUpload(
        input: ResumeExtractionInput,
    ): Promise<ResumeUploadRecord>;
    failPendingAnalysis(resumeId: string): Promise<void>;
    getById(resumeId: string): Promise<ResumeDocument | undefined>;
    getPendingUpload(
        resumeId: string,
    ): Promise<PendingResumeUpload | undefined>;
    getSummary(resumeId: string): Promise<ResumeSummary | undefined>;
    listSummaries(): Promise<ResumeSummary[]>;
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

export interface ResumeAnalysisQueue {
    enqueue(job: ResumeAnalysisJob): Promise<void>;
}

export type AppServices = {
    resumeStore: ResumeStore;
    jdStore: JobDescriptionStore;
    ai: AiExtractor;
    resumeAnalysisQueue: ResumeAnalysisQueue;
};

export class DuplicateJobDescriptionError extends Error {
    constructor(id: string) {
        super(`Job description already exists: ${id}`);
        this.name = "DuplicateJobDescriptionError";
    }
}
