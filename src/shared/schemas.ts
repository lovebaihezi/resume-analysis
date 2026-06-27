import { type as arkType } from "arktype";
import type {
    JdAnalyzeResult,
    JdInfoResult,
    JdListResult,
    JdMatchResult,
    ResumeAnalysis,
    ResumeInfoResult,
    ResumeJdMatch,
    ResumeListResult,
    ResumeStatusResult,
    ResumeUploadResult,
} from "./types";
import type { ResumeStreamEvent } from "./resumeStream";

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

const resumeStatus = "'creating' | 'ready' | 'failed' | 'archived'";
const resumeStreamPhase =
    "'converting_pdf_to_markdown' | 'extracting_content_from_markdown' | 'saving_resume'";

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

const jobDescriptionSummary = arkType({
    id: "string",
    tags: "string[]",
    title: "string",
    updatedAt: "string",
});

const matchDimension = "'edu' | 'project' | 'work' | 'skill' | 'overall'";

const resumeMatchDimension = arkType({
    dimension: matchDimension,
    label: "string",
    percentage: "number",
    rationale: "string",
    score: "number",
});

export const resumeJdMatchSchema = arkType({
    dimensions: resumeMatchDimension.array(),
    intro: {
        advantages: "string",
        disadvantages: "string",
    },
    resumeId: "string",
    resumeName: "string",
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
    resume: resumeAnalysisSchema,
});

export const resumeStatusResultSchema = resumeSummary;

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

const resumeStreamStatusEvent = arkType({
    message: "string",
    phase: resumeStreamPhase,
    type: "'status'",
});

const resumeStreamTokenEvent = arkType({
    patch: "unknown",
    path: "string",
    type: "'token'",
    value: "string",
});

const resumeStreamCompleteEvent = arkType({
    resume: resumeAnalysisSchema,
    resumeId: "string",
    type: "'complete'",
});

const resumeStreamErrorEvent = arkType({
    message: "string",
    type: "'error'",
});

export const resumeStreamEventSchema = resumeStreamStatusEvent
    .or(resumeStreamTokenEvent)
    .or(resumeStreamCompleteEvent)
    .or(resumeStreamErrorEvent);

export const jdMatchResultSchema = arkType({
    jd: jobDescription,
    match: resumeJdMatchSchema,
});

export function parseResumeUploadResult(data: unknown): ResumeUploadResult {
    return resumeUploadResultSchema.assert(data) as ResumeUploadResult;
}

export function parseResumeListResult(data: unknown): ResumeListResult {
    return resumeListResultSchema.assert(data) as ResumeListResult;
}

export function parseResumeAnalysis(data: unknown): ResumeAnalysis {
    return resumeAnalysisSchema.assert(data) as ResumeAnalysis;
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

export function parseJdInfoResult(data: unknown): JdInfoResult {
    return jdInfoResultSchema.assert(data) as JdInfoResult;
}

export function parseResumeStreamEvent(data: unknown): ResumeStreamEvent {
    return resumeStreamEventSchema.assert(data) as ResumeStreamEvent;
}

export function parseResumeJdMatch(data: unknown): ResumeJdMatch {
    return resumeJdMatchSchema.assert(data) as ResumeJdMatch;
}

export function parseJdMatchResult(data: unknown): JdMatchResult {
    return jdMatchResultSchema.assert(data) as JdMatchResult;
}
