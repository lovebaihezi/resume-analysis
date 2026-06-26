export type UploadSource = "click" | "drag" | "paste";

export type SocialLink = {
    name: string;
    link: string;
};

export type Basic = {
    name: string;
    email?: string;
    phone?: string;
    socialMedia: SocialLink[];
};

export type Edu = {
    school?: string;
    degree?: string;
    awards: Array<{ name: string; value: string }>;
    experiences: Array<{ des: string }>;
};

export type Work = {
    company?: string;
    duration: string[];
    type?: "intern" | "full-time";
    location?: "hybrid" | "remote" | "on-site";
    level?: string;
    role?: string;
    des?: string;
};

export type Project = {
    name?: string;
    duration: string[];
    type?: "open-source" | "hobby";
    role?: "maintainer" | "contributor" | "owner";
    des?: string;
};

export type Skill = {
    name: string;
    des?: string;
};

export type ResumeAnalysis = {
    rawText: string;
    basic: Basic;
    edu: Edu[];
    work: Work[];
    project: Project[];
    skills: Skill[];
};

export type ResumeSummary = {
    name: string;
    workDuration: string;
    highestEducation: string;
    skills: string[];
};

export type JobDescription = {
    id: string;
    title: string;
    rawText: string;
    des: string;
    tags: string[];
    requiredSkills: string[];
    requiredExperiences: string[];
};

export type JobDescriptionSummary = {
    id: string;
    tags: string[];
    title: string;
};

export type ResumeUploadResult = {
    resume: ResumeAnalysis;
    upload: {
        bytes: number;
        percent: number;
        source: UploadSource;
    };
};

export type ResumeListResult = {
    count: number;
    resumes: ResumeSummary[];
};

export type ResumeInfoResult = {
    resume: ResumeAnalysis;
};

export type JdAnalyzeResult = {
    jd: JobDescription;
};

export type JdListResult = {
    count: number;
    jds: JobDescriptionSummary[];
};

export type JdInfoResult = {
    jd: JobDescription;
};

const degreeRank = new Map([
    ["primary school", 1],
    ["high school", 2],
    ["senior high school", 3],
    ["bachelor", 4],
    ["bacholar", 4],
    ["master", 5],
    ["phd", 6],
]);

export function resumeWriterKey(name: string): string {
    return name.trim().replace(/\s+/g, " ");
}

export function resumeWriterSlug(name: string): string {
    return encodeURIComponent(resumeWriterKey(name));
}

export function summarizeResume(resume: ResumeAnalysis): ResumeSummary {
    const workDates = resume.work
        .flatMap((work) => work.duration)
        .filter(Boolean)
        .toSorted();
    const highestEducation =
        resume.edu
            .map((edu) => edu.degree?.trim())
            .filter((degree): degree is string => Boolean(degree))
            .toSorted((a, b) => {
                const left = degreeRank.get(a.toLowerCase()) ?? 0;
                const right = degreeRank.get(b.toLowerCase()) ?? 0;

                return right - left;
            })[0] ?? "Unknown";

    return {
        name: resume.basic.name,
        workDuration:
            workDates.length > 1
                ? `${workDates[0]} to ${workDates[workDates.length - 1]}`
                : (workDates[0] ?? "Unknown"),
        highestEducation,
        skills: resume.skills.map((skill) => skill.name),
    };
}
