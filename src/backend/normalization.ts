import type { Project, ResumeAnalysis, Work } from "../shared/types";

const workTypes = new Set(["intern", "full-time"]);
const workLocations = new Set(["hybrid", "remote", "on-site"]);
const projectTypes = new Set(["open-source", "hobby"]);
const projectRoles = new Set(["maintainer", "contributor", "owner"]);

export function normalizeResumeAnalysis(data: unknown): ResumeAnalysis {
    const value = data as Partial<ResumeAnalysis>;

    return {
        basic: {
            email: value.basic?.email ?? "",
            name: value.basic?.name?.trim() || "Unknown",
            phone: value.basic?.phone ?? "",
            socialMedia: Array.isArray(value.basic?.socialMedia)
                ? value.basic.socialMedia
                : [],
        },
        edu: Array.isArray(value.edu) ? value.edu : [],
        project: Array.isArray(value.project)
            ? value.project.map(normalizeProject)
            : [],
        rawText: value.rawText ?? "",
        skills: Array.isArray(value.skills) ? value.skills : [],
        work: Array.isArray(value.work) ? value.work.map(normalizeWork) : [],
    };
}

function normalizeWork(work: Work): Work {
    const result: Work = {
        duration: Array.isArray(work.duration) ? work.duration : [],
    };

    assignNonBlank(result, "company", work.company);
    assignEnum(result, "type", work.type, workTypes);
    assignEnum(result, "location", work.location, workLocations);
    assignNonBlank(result, "level", work.level);
    assignNonBlank(result, "role", work.role);
    assignNonBlank(result, "des", work.des);

    return result;
}

function normalizeProject(project: Project): Project {
    const result: Project = {
        duration: Array.isArray(project.duration) ? project.duration : [],
    };

    assignNonBlank(result, "name", project.name);
    assignEnum(result, "type", project.type, projectTypes);
    assignEnum(result, "role", project.role, projectRoles);
    assignNonBlank(result, "des", project.des);

    return result;
}

function assignNonBlank<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K] | undefined,
): void {
    if (typeof value !== "string" || !value.trim()) {
        return;
    }

    target[key] = value;
}

function assignEnum<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K] | undefined,
    allowed: Set<string>,
): void {
    if (typeof value !== "string" || !allowed.has(value)) {
        return;
    }

    target[key] = value;
}
