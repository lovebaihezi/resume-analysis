import { type as arkType } from "arktype";
import type {
    JdAnalyzeResult,
    JdListResult,
    ResumeInfoResult,
    ResumeListResult,
    ResumeStatusResult,
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

const resumeAnalysis = arkType({
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

const resumeStatus = "'creating' | 'ready' | 'failed' | 'archived'";

const resumeSummary = arkType({
    "archivedAt?": "string",
    createdAt: "string",
    name: "string",
    resumeId: "string",
    status: resumeStatus,
    updatedAt: "string",
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

export const resumeUploadResultSchema = arkType({
    "archivedAt?": "string",
    createdAt: "string",
    resumeId: "string",
    status: resumeStatus,
    updatedAt: "string",
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
    "archivedAt?": "string",
    createdAt: "string",
    resumeId: "string",
    status: resumeStatus,
    updatedAt: "string",
    resume: resumeAnalysis,
});

export const resumeStatusResultSchema = resumeSummary;

export const jdAnalyzeResultSchema = arkType({
    jd: jobDescription,
});

export const jdListResultSchema = arkType({
    count: "number",
    jds: jobDescription.array(),
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

export function parseResumeStatusResult(data: unknown): ResumeStatusResult {
    return resumeStatusResultSchema.assert(data) as ResumeStatusResult;
}

export function parseJdAnalyzeResult(data: unknown): JdAnalyzeResult {
    return jdAnalyzeResultSchema.assert(data) as JdAnalyzeResult;
}

export function parseJdListResult(data: unknown): JdListResult {
    return jdListResultSchema.assert(data) as JdListResult;
}
