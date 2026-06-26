import { type as arkType } from "arktype";
import type {
    JdAnalyzeResult,
    JdInfoResult,
    JdListResult,
    ResumeAnalysis,
    ResumeInfoResult,
    ResumeListResult,
    ResumeUploadResult,
} from "./types";

const socialLink = arkType({
    name: "string",
    link: "string",
});

const award = arkType({ name: "string", value: "string" });
const experience = arkType({ des: "string" });

const edu = arkType({
    "school?": "string",
    "degree?": "string",
    awards: award.array(),
    experiences: experience.array(),
});

const work = arkType({
    "company?": "string",
    duration: "string[]",
    "type?": "'intern' | 'full-time'",
    "location?": "'hybrid' | 'remote' | 'on-site'",
    "level?": "string",
    "role?": "string",
    "des?": "string",
});

const project = arkType({
    "name?": "string",
    duration: "string[]",
    "type?": "'open-source' | 'hobby'",
    "role?": "'maintainer' | 'contributor' | 'owner'",
    "des?": "string",
});

const skill = arkType({
    name: "string",
    "des?": "string",
});

export const resumeAnalysisSchema = arkType({
    rawText: "string",
    basic: {
        name: "string",
        "email?": "string",
        "phone?": "string",
        socialMedia: socialLink.array(),
    },
    edu: edu.array(),
    work: work.array(),
    project: project.array(),
    skills: skill.array(),
});

const resumeSummary = arkType({
    name: "string",
    workDuration: "string",
    highestEducation: "string",
    skills: "string[]",
});

const jobDescription = arkType({
    id: "string",
    title: "string",
    rawText: "string",
    des: "string",
    tags: "string[]",
    requiredSkills: "string[]",
    requiredExperiences: "string[]",
});

const jobDescriptionSummary = arkType({
    id: "string",
    tags: "string[]",
    title: "string",
});

export const resumeUploadResultSchema = arkType({
    resume: resumeAnalysisSchema,
    upload: {
        bytes: "number",
        percent: "number",
        source: "'click' | 'drag' | 'paste'",
    },
});

export const resumeListResultSchema = arkType({
    count: "number",
    resumes: resumeSummary.array(),
});

export const resumeInfoResultSchema = arkType({
    resume: resumeAnalysisSchema,
});

export const jdAnalyzeResultSchema = arkType({
    jd: jobDescription,
});

export const jdListResultSchema = arkType({
    count: "number",
    jds: jobDescriptionSummary.array(),
});

export const jdInfoResultSchema = arkType({
    jd: jobDescription,
});

export function parseResumeUploadResult(data: unknown): ResumeUploadResult {
    return resumeUploadResultSchema.assert(data) as ResumeUploadResult;
}

export function parseResumeListResult(data: unknown): ResumeListResult {
    return resumeListResultSchema.assert(data) as ResumeListResult;
}

export function parseResumeInfoResult(data: unknown): ResumeInfoResult {
    return resumeInfoResultSchema.assert(data) as ResumeInfoResult;
}

export function parseResumeAnalysis(data: unknown): ResumeAnalysis {
    return resumeAnalysisSchema.assert(data) as ResumeAnalysis;
}

export function parseJdAnalyzeResult(data: unknown): JdAnalyzeResult {
    return jdAnalyzeResultSchema.assert(data) as JdAnalyzeResult;
}

export function parseJdListResult(data: unknown): JdListResult {
    return jdListResultSchema.assert(data) as JdListResult;
}

export function parseJdInfoResult(data: unknown): JdInfoResult {
    return jdInfoResultSchema.assert(data) as JdInfoResult;
}
