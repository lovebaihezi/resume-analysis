import type {
    JobDescription,
    ResumeAnalysis,
    UploadSource,
} from "../shared/types";
import type { ObservabilityContext } from "./observability";

export type ResumeExtractionInput = {
    fileName: string;
    bytes: Uint8Array;
    source: UploadSource;
};

export interface ResumeStore {
    save(resume: ResumeAnalysis, context?: ObservabilityContext): Promise<void>;
    getByName(
        name: string,
        context?: ObservabilityContext,
    ): Promise<ResumeAnalysis | undefined>;
    list(context?: ObservabilityContext): Promise<ResumeAnalysis[]>;
    count(context?: ObservabilityContext): Promise<number>;
}

export interface JobDescriptionStore {
    save(jd: JobDescription, context?: ObservabilityContext): Promise<void>;
    list(context?: ObservabilityContext): Promise<JobDescription[]>;
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

export type AppServices = {
    resumeStore: ResumeStore;
    jdStore: JobDescriptionStore;
    ai: AiExtractor;
};
