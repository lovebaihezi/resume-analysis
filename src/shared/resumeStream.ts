import type {
    Basic,
    Edu,
    Project,
    ResumeAnalysis,
    Skill,
    SocialLink,
    Work,
} from "./types";

export type ResumeStreamPhase =
    | "converting_pdf_to_markdown"
    | "extracting_content_from_markdown"
    | "saving_resume";

export type ResumeTokenPatch =
    | string
    | ResumeTokenPatch[]
    | { [key: string]: ResumeTokenPatch }
    | null
    | undefined;

export type ResumeFieldToken = {
    path: string;
    value: string;
    patch: ResumeTokenPatch;
};

export type ResumeStreamEvent =
    | {
          message: string;
          phase: ResumeStreamPhase;
          type: "status";
      }
    | {
          path: string;
          patch: ResumeTokenPatch;
          type: "token";
          value: string;
      }
    | {
          resume: ResumeAnalysis;
          resumeId: string;
          type: "complete";
      }
    | {
          message: string;
          type: "error";
      };

const tagNamePattern =
    /^(?:[A-Za-z][A-Za-z0-9]*|[0-9]+)(?:\.(?:[A-Za-z][A-Za-z0-9]*|[0-9]+))*$/;
const maxTagNameChars = 160;
const maxFieldChars = 16_000;

type ParserState = "text" | "openTag" | "content" | "closeTag";

export class ResumeFieldTagParser {
    private closeTag = "";
    private content = "";
    private currentTag = "";
    private openTag = "";
    private state: ParserState = "text";

    push(chunk: string): ResumeFieldToken[] {
        const tokens: ResumeFieldToken[] = [];

        for (const char of chunk) {
            const token = this.readChar(char);

            if (token) {
                tokens.push(token);
            }
        }

        return tokens;
    }

    flush(): ResumeFieldToken[] {
        this.reset();

        return [];
    }

    private readChar(char: string): ResumeFieldToken | undefined {
        if (this.state === "text") {
            if (char === "<") {
                this.openTag = "";
                this.state = "openTag";
            }

            return undefined;
        }

        if (this.state === "openTag") {
            if (char === "<") {
                this.openTag = "";
                return undefined;
            }

            if (char === ">") {
                if (!isValidFieldPath(this.openTag)) {
                    this.reset();
                    return undefined;
                }

                this.currentTag = this.openTag;
                this.content = "";
                this.openTag = "";
                this.state = "content";
                return undefined;
            }

            this.openTag += char;

            if (this.openTag.length > maxTagNameChars) {
                this.reset();
            }

            return undefined;
        }

        if (this.state === "content") {
            if (char === "<") {
                this.closeTag = "";
                this.state = "closeTag";
                return undefined;
            }

            this.content += char;

            if (this.content.length > maxFieldChars) {
                this.reset();
            }

            return undefined;
        }

        if (char === ">") {
            const expectedCloseTag = `/${this.currentTag}`;

            if (this.closeTag !== expectedCloseTag) {
                this.reset();
                return undefined;
            }

            const token = createResumeFieldToken(
                this.currentTag,
                decodeXmlEntities(this.content.trim()),
            );
            this.reset();
            return token;
        }

        this.closeTag += char;

        if (this.closeTag.length > maxTagNameChars + 1) {
            this.reset();
        }

        return undefined;
    }

    private reset(): void {
        this.closeTag = "";
        this.content = "";
        this.currentTag = "";
        this.openTag = "";
        this.state = "text";
    }
}

export function parseResumeFieldTags(text: string): ResumeFieldToken[] {
    const parser = new ResumeFieldTagParser();
    const tokens = parser.push(text);

    parser.flush();

    return tokens;
}

export function createResumeFieldToken(
    path: string,
    value: string,
): ResumeFieldToken {
    if (!isValidFieldPath(path)) {
        throw new Error(`Invalid resume field path: ${path}`);
    }

    return {
        patch: patchFromPath(path.split("."), value),
        path,
        value,
    };
}

export function mergeResumeTokenPatch(
    left: ResumeTokenPatch,
    right: ResumeTokenPatch,
): ResumeTokenPatch {
    if (isMissing(right)) {
        return clonePatch(left);
    }

    if (isMissing(left)) {
        return clonePatch(right);
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        const merged = left.map(clonePatch);

        for (let index = 0; index < right.length; index += 1) {
            const value = right[index];

            if (isMissing(value)) {
                continue;
            }

            merged[index] = mergeResumeTokenPatch(merged[index], value);
        }

        return merged;
    }

    if (isPlainPatchObject(left) && isPlainPatchObject(right)) {
        const merged: { [key: string]: ResumeTokenPatch } = {};
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

        for (const key of keys) {
            merged[key] = mergeResumeTokenPatch(left[key], right[key]);
        }

        return merged;
    }

    return clonePatch(right);
}

export function collectResumeFieldTokens(
    tokens: Iterable<ResumeFieldToken>,
): ResumeTokenPatch {
    let collected: ResumeTokenPatch;

    for (const token of tokens) {
        collected = mergeResumeTokenPatch(collected, token.patch);
    }

    return collected;
}

export function compactResumeTokenPatch(
    patch: ResumeTokenPatch,
): ResumeTokenPatch {
    if (isMissing(patch)) {
        return undefined;
    }

    if (typeof patch === "string") {
        return patch;
    }

    if (Array.isArray(patch)) {
        return patch
            .filter((value) => !isMissing(value))
            .map((value) => compactResumeTokenPatch(value));
    }

    const compacted: { [key: string]: ResumeTokenPatch } = {};

    for (const [key, value] of Object.entries(patch)) {
        if (!isMissing(value)) {
            compacted[key] = compactResumeTokenPatch(value);
        }
    }

    return compacted;
}

export function resumeFromTokenPatch(patch: ResumeTokenPatch): ResumeAnalysis {
    const compacted = asRecord(compactResumeTokenPatch(patch));

    return {
        basic: readBasic(compacted?.basic),
        edu: readRecordArray(compacted?.edu).map(readEdu),
        project: readRecordArray(compacted?.project).map(readProject),
        rawText: readString(compacted?.rawText),
        skills: readRecordArray(compacted?.skills).map(readSkill),
        work: readRecordArray(compacted?.work).map(readWork),
    };
}

export function resumeAnalysisToFieldTags(resume: ResumeAnalysis): string[] {
    const tags: string[] = [];
    const emit = (path: string, value: string | undefined) => {
        if (value === undefined) {
            return;
        }

        tags.push(`<${path}>${encodeXmlEntities(value)}</${path}>`);
    };

    emit("rawText", resume.rawText);
    emit("basic.name", resume.basic.name);
    emit("basic.email", resume.basic.email);
    emit("basic.phone", resume.basic.phone);

    resume.basic.socialMedia.forEach((link, index) => {
        emit(`basic.socialMedia.${index}.name`, link.name);
        emit(`basic.socialMedia.${index}.link`, link.link);
    });

    resume.edu.forEach((edu, eduIndex) => {
        emit(`edu.${eduIndex}.school`, edu.school);
        emit(`edu.${eduIndex}.degree`, edu.degree);
        edu.awards.forEach((award, awardIndex) => {
            emit(`edu.${eduIndex}.awards.${awardIndex}.name`, award.name);
            emit(`edu.${eduIndex}.awards.${awardIndex}.value`, award.value);
        });
        edu.experiences.forEach((experience, experienceIndex) => {
            emit(
                `edu.${eduIndex}.experiences.${experienceIndex}.des`,
                experience.des,
            );
        });
    });

    resume.work.forEach((work, workIndex) => {
        emit(`work.${workIndex}.company`, work.company);
        work.duration.forEach((duration, durationIndex) => {
            emit(`work.${workIndex}.duration.${durationIndex}`, duration);
        });
        emit(`work.${workIndex}.type`, work.type);
        emit(`work.${workIndex}.location`, work.location);
        emit(`work.${workIndex}.level`, work.level);
        emit(`work.${workIndex}.role`, work.role);
        emit(`work.${workIndex}.des`, work.des);
    });

    resume.project.forEach((project, projectIndex) => {
        emit(`project.${projectIndex}.name`, project.name);
        project.duration.forEach((duration, durationIndex) => {
            emit(`project.${projectIndex}.duration.${durationIndex}`, duration);
        });
        emit(`project.${projectIndex}.type`, project.type);
        emit(`project.${projectIndex}.role`, project.role);
        emit(`project.${projectIndex}.des`, project.des);
    });

    resume.skills.forEach((skill, skillIndex) => {
        emit(`skills.${skillIndex}.name`, skill.name);
        emit(`skills.${skillIndex}.des`, skill.des);
    });

    return tags;
}

export function resumeAnalysisToFieldTokens(
    resume: ResumeAnalysis,
): ResumeFieldToken[] {
    return parseResumeFieldTags(resumeAnalysisToFieldTags(resume).join(""));
}

function isValidFieldPath(path: string): boolean {
    return tagNamePattern.test(path);
}

function patchFromPath(parts: string[], value: string): ResumeTokenPatch {
    const [head, ...tail] = parts;

    if (!head) {
        return value;
    }

    const child = patchFromPath(tail, value);
    const index = readArrayIndex(head);

    if (index !== undefined) {
        const array: ResumeTokenPatch[] = [];
        array[index] = child;
        return array;
    }

    return {
        [head]: child,
    };
}

function readArrayIndex(value: string): number | undefined {
    if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
        return undefined;
    }

    const index = Number(value);

    return Number.isSafeInteger(index) ? index : undefined;
}

function clonePatch(patch: ResumeTokenPatch): ResumeTokenPatch {
    if (isMissing(patch)) {
        return undefined;
    }

    if (typeof patch === "string") {
        return patch;
    }

    if (Array.isArray(patch)) {
        return patch.map(clonePatch);
    }

    const cloned: { [key: string]: ResumeTokenPatch } = {};

    for (const [key, value] of Object.entries(patch)) {
        cloned[key] = clonePatch(value);
    }

    return cloned;
}

function isPlainPatchObject(
    value: ResumeTokenPatch,
): value is { [key: string]: ResumeTokenPatch } {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissing(value: ResumeTokenPatch): value is null | undefined {
    return value === undefined || value === null;
}

function readBasic(value: unknown): Basic {
    const record = asRecord(value);

    return {
        email: readString(record?.email),
        name: readString(record?.name).trim() || "Unknown",
        phone: readString(record?.phone),
        socialMedia: readRecordArray(record?.socialMedia).map(readSocialLink),
    };
}

function readSocialLink(value: unknown): SocialLink {
    const record = asRecord(value);

    return {
        link: readString(record?.link),
        name: readString(record?.name),
    };
}

function readEdu(value: unknown): Edu {
    const record = asRecord(value);

    return {
        awards: readRecordArray(record?.awards).map((award) => ({
            name: readString(award.name),
            value: readString(award.value),
        })),
        degree: readString(record?.degree),
        experiences: readRecordArray(record?.experiences).map((experience) => ({
            des: readString(experience.des),
        })),
        school: readString(record?.school),
    };
}

function readWork(value: unknown): Work {
    const record = asRecord(value);
    const work: Work = {
        duration: readStringList(record?.duration),
    };

    assignString(work, "company", record?.company);
    assignEnum(work, "type", record?.type, new Set(["intern", "full-time"]));
    assignEnum(
        work,
        "location",
        record?.location,
        new Set(["hybrid", "remote", "on-site"]),
    );
    assignString(work, "level", record?.level);
    assignString(work, "role", record?.role);
    assignString(work, "des", record?.des);

    return work;
}

function readProject(value: unknown): Project {
    const record = asRecord(value);
    const project: Project = {
        duration: readStringList(record?.duration),
    };

    assignString(project, "name", record?.name);
    assignEnum(
        project,
        "type",
        record?.type,
        new Set(["open-source", "hobby"]),
    );
    assignEnum(
        project,
        "role",
        record?.role,
        new Set(["maintainer", "contributor", "owner"]),
    );
    assignString(project, "des", record?.des);

    return project;
}

function readSkill(value: unknown): Skill {
    const record = asRecord(value);

    return {
        des: readString(record?.des),
        name: readString(record?.name),
    };
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value
              .map(asRecord)
              .filter((item): item is Record<string, unknown> => Boolean(item))
        : [];
}

function readStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((item): item is string => typeof item === "string")
            .filter((item) => item.trim().length > 0);
    }

    if (typeof value === "string") {
        return value
            .split(/[\n,|]+/g)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return [];
}

function assignString<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: unknown,
): void {
    const stringValue = readString(value).trim();

    if (stringValue) {
        target[key] = stringValue as T[K];
    }
}

function assignEnum<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: unknown,
    allowed: Set<string>,
): void {
    if (typeof value === "string" && allowed.has(value)) {
        target[key] = value as T[K];
    }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function readString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function encodeXmlEntities(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}
