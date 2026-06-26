import type {
    JobDescription,
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
    save(jd: JobDescription): Promise<void>;
    list(): Promise<JobDescription[]>;
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
