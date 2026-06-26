import type {
    JobDescription,
    JobDescriptionSummary,
    ResumeAnalysis,
    ResumeDocument,
    ResumeMetadata,
    UploadSource,
    ResumeSummary,
} from "../shared/types";
import type { ObservabilityContext } from "./observability";

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
    requestId?: string;
    resumeId: string;
};

export interface ResumeStore {
    archive(resumeId: string): Promise<ResumeSummary | undefined>;
    completePendingAnalysis(
        resumeId: string,
        resume: ResumeAnalysis,
        context?: ObservabilityContext,
    ): Promise<ResumeDocument>;
    createPendingUpload(
        input: ResumeExtractionInput,
        context?: ObservabilityContext,
    ): Promise<ResumeUploadRecord>;
    failPendingAnalysis(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<void>;
    getById(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<ResumeDocument | undefined>;
    getPendingUpload(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<PendingResumeUpload | undefined>;
    getSummary(
        resumeId: string,
        context?: ObservabilityContext,
    ): Promise<ResumeSummary | undefined>;
    listSummaries(context?: ObservabilityContext): Promise<ResumeSummary[]>;
    count(context?: ObservabilityContext): Promise<number>;
}

export interface JobDescriptionStore {
    save(
        jd: JobDescription,
        context?: ObservabilityContext,
    ): Promise<JobDescription>;
    getById(
        id: string,
        context?: ObservabilityContext,
    ): Promise<JobDescription | undefined>;
    listSummaries(
        context?: ObservabilityContext,
    ): Promise<JobDescriptionSummary[]>;
    count(context?: ObservabilityContext): Promise<number>;
}

export interface AiExtractor {
    extractResume(
        input: ResumeExtractionInput,
        context?: ObservabilityContext,
    ): Promise<ResumeAnalysis>;
    analyzeJobDescription(
        rawText: string,
        context?: ObservabilityContext,
    ): Promise<JobDescription>;
}

export interface ResumeAnalysisQueue {
    enqueue(
        job: ResumeAnalysisJob,
        context?: ObservabilityContext,
    ): Promise<void>;
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
