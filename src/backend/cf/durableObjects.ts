import { DurableObject } from "cloudflare:workers";
import type { PendingResumeUpload } from "../ports";
import type {
    JobDescription,
    ResumeAnalysis,
    ResumeDocument,
    ResumeMetadata,
    ResumeSummary,
    UploadSource,
} from "../../shared/types";

const VALUE_KEY = "value";
const IDS_KEY = "ids";

type ResumeRegistryRow = {
    archived_at: string | null;
    created_at: string;
    highest_education: string;
    name: string;
    resume_id: string;
    skills_json: string;
    status: ResumeMetadata["status"];
    updated_at: string;
    work_duration: string;
};

type ResumeDocumentRow = {
    archived_at: string | null;
    created_at: string;
    failure: string | null;
    file_name: string;
    pdf_base64: string | null;
    resume_id: string;
    resume_json: string;
    source: UploadSource;
    status: ResumeMetadata["status"];
    updated_at: string;
};

export class ResumeRegistryObject extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        ctx.blockConcurrencyWhile(async () => {
            this.ctx.storage.sql.exec(`
                CREATE TABLE IF NOT EXISTS resumes (
                    resume_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    name TEXT NOT NULL,
                    work_duration TEXT NOT NULL,
                    highest_education TEXT NOT NULL,
                    skills_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived_at TEXT
                );
            `);
            this.ctx.storage.sql.exec(`
                CREATE INDEX IF NOT EXISTS idx_resumes_status_created
                ON resumes (status, archived_at, created_at);
            `);
        });
    }

    async create(metadata: ResumeMetadata): Promise<void> {
        this.ctx.storage.sql.exec(
            `INSERT INTO resumes (
                resume_id,
                status,
                name,
                work_duration,
                highest_education,
                skills_json,
                created_at,
                updated_at,
                archived_at
            ) VALUES (?, ?, '', 'Unknown', 'Unknown', '[]', ?, ?, ?)`,
            metadata.resumeId,
            metadata.status,
            metadata.createdAt,
            metadata.updatedAt,
            metadata.archivedAt ?? null,
        );
    }

    async markReady(summary: ResumeSummary): Promise<void> {
        this.ctx.storage.sql.exec(
            `UPDATE resumes
             SET status = ?,
                 name = ?,
                 work_duration = ?,
                 highest_education = ?,
                 skills_json = ?,
                 updated_at = ?,
                 archived_at = ?
             WHERE resume_id = ?`,
            "ready",
            summary.name,
            summary.workDuration,
            summary.highestEducation,
            JSON.stringify(summary.skills),
            summary.updatedAt,
            summary.archivedAt ?? null,
            summary.resumeId,
        );
    }

    async markFailed(resumeId: string, updatedAt: string): Promise<void> {
        this.ctx.storage.sql.exec(
            `UPDATE resumes
             SET status = ?, updated_at = ?
             WHERE resume_id = ?`,
            "failed",
            updatedAt,
            resumeId,
        );
    }

    async archive(resumeId: string, archivedAt: string): Promise<void> {
        this.ctx.storage.sql.exec(
            `UPDATE resumes
             SET status = ?, archived_at = ?, updated_at = ?
             WHERE resume_id = ?`,
            "archived",
            archivedAt,
            archivedAt,
            resumeId,
        );
    }

    async getSummary(resumeId: string): Promise<ResumeSummary | undefined> {
        const row = this.ctx.storage.sql
            .exec<ResumeRegistryRow>(
                "SELECT * FROM resumes WHERE resume_id = ?",
                resumeId,
            )
            .toArray()[0];

        return row ? resumeSummaryFromRow(row) : undefined;
    }

    async listSummaries(): Promise<ResumeSummary[]> {
        return this.ctx.storage.sql
            .exec<ResumeRegistryRow>(
                `SELECT * FROM resumes
                 WHERE status = ? AND archived_at IS NULL
                 ORDER BY resume_id DESC`,
                "ready",
            )
            .toArray()
            .map(resumeSummaryFromRow);
    }

    async count(): Promise<number> {
        const row = this.ctx.storage.sql
            .exec<{ count: number }>(
                `SELECT COUNT(*) AS count
                 FROM resumes
                 WHERE status = ? AND archived_at IS NULL`,
                "ready",
            )
            .toArray()[0];

        return row?.count ?? 0;
    }
}

export class ResumeDocumentObject extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        ctx.blockConcurrencyWhile(async () => {
            this.ctx.storage.sql.exec(`
                CREATE TABLE IF NOT EXISTS resume_documents (
                    resume_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    resume_json TEXT NOT NULL,
                    file_name TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'click',
                    pdf_base64 TEXT,
                    failure TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived_at TEXT
                );
            `);
            addColumnIfMissing(
                this.ctx.storage.sql,
                "ALTER TABLE resume_documents ADD COLUMN file_name TEXT NOT NULL DEFAULT ''",
            );
            addColumnIfMissing(
                this.ctx.storage.sql,
                "ALTER TABLE resume_documents ADD COLUMN source TEXT NOT NULL DEFAULT 'click'",
            );
            addColumnIfMissing(
                this.ctx.storage.sql,
                "ALTER TABLE resume_documents ADD COLUMN pdf_base64 TEXT",
            );
            addColumnIfMissing(
                this.ctx.storage.sql,
                "ALTER TABLE resume_documents ADD COLUMN failure TEXT",
            );
        });
    }

    async init(document: ResumeDocument): Promise<void> {
        this.ctx.storage.sql.exec(
            `INSERT INTO resume_documents (
                resume_id,
                status,
                resume_json,
                file_name,
                source,
                pdf_base64,
                failure,
                created_at,
                updated_at,
                archived_at
            ) VALUES (?, ?, ?, '', 'click', NULL, NULL, ?, ?, ?)`,
            document.resumeId,
            document.status,
            JSON.stringify(document.resume),
            document.createdAt,
            document.updatedAt,
            document.archivedAt ?? null,
        );
    }

    async initUpload(upload: PendingResumeUpload): Promise<void> {
        this.ctx.storage.sql.exec(
            `INSERT INTO resume_documents (
                resume_id,
                status,
                resume_json,
                file_name,
                source,
                pdf_base64,
                failure,
                created_at,
                updated_at,
                archived_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
            upload.resumeId,
            upload.status,
            JSON.stringify(emptyResume()),
            upload.fileName,
            upload.source,
            bytesToBase64(upload.bytes),
            upload.createdAt,
            upload.updatedAt,
            upload.archivedAt ?? null,
        );
    }

    async markReady(document: ResumeDocument): Promise<void> {
        this.ctx.storage.sql.exec(
            `UPDATE resume_documents
             SET status = ?,
                 resume_json = ?,
                 pdf_base64 = NULL,
                 failure = NULL,
                 updated_at = ?,
                 archived_at = ?
             WHERE resume_id = ?`,
            document.status,
            JSON.stringify(document.resume),
            document.updatedAt,
            document.archivedAt ?? null,
            document.resumeId,
        );
    }

    async markFailed(updatedAt: string): Promise<void> {
        const row = this.getRow();

        if (!row) {
            return;
        }

        this.ctx.storage.sql.exec(
            `UPDATE resume_documents
             SET status = ?,
                 pdf_base64 = NULL,
                 failure = ?,
                 updated_at = ?
             WHERE resume_id = ?`,
            "failed",
            "Resume analysis failed",
            updatedAt,
            row.resume_id,
        );
    }

    async get(): Promise<ResumeDocument | undefined> {
        const row = this.getRow();

        return row ? resumeDocumentFromRow(row) : undefined;
    }

    async getPendingUpload(): Promise<PendingResumeUpload | undefined> {
        const row = this.getRow();

        if (!row || row.status !== "creating" || !row.pdf_base64) {
            return undefined;
        }

        return {
            archivedAt: row.archived_at ?? undefined,
            bytes: base64ToBytes(row.pdf_base64),
            createdAt: row.created_at,
            fileName: row.file_name,
            resumeId: row.resume_id,
            source: readUploadSource(row.source),
            status: row.status,
            updatedAt: row.updated_at,
        };
    }

    async getMetadata(): Promise<ResumeMetadata | undefined> {
        const document = await this.get();

        if (!document) {
            return undefined;
        }

        const { resume: _resume, ...metadata } = document;

        return metadata;
    }

    async archive(archivedAt: string): Promise<void> {
        this.ctx.storage.sql.exec(
            `UPDATE resume_documents
             SET status = ?, archived_at = ?, updated_at = ?`,
            "archived",
            archivedAt,
            archivedAt,
        );
    }

    private getRow(): ResumeDocumentRow | undefined {
        return this.ctx.storage.sql
            .exec<ResumeDocumentRow>("SELECT * FROM resume_documents")
            .toArray()[0];
    }
}

function resumeSummaryFromRow(row: ResumeRegistryRow): ResumeSummary {
    return {
        archivedAt: row.archived_at ?? undefined,
        createdAt: row.created_at,
        highestEducation: row.highest_education,
        name: row.name,
        resumeId: row.resume_id,
        skills: readStringArray(row.skills_json),
        status: row.status,
        updatedAt: row.updated_at,
        workDuration: row.work_duration,
    };
}

function resumeDocumentFromRow(row: ResumeDocumentRow): ResumeDocument {
    return {
        archivedAt: row.archived_at ?? undefined,
        createdAt: row.created_at,
        resume: JSON.parse(row.resume_json) as ResumeAnalysis,
        resumeId: row.resume_id,
        status: row.status,
        updatedAt: row.updated_at,
    };
}

function readStringArray(value: string): string[] {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
}

function addColumnIfMissing(
    sql: DurableObjectStorage["sql"],
    statement: string,
): void {
    try {
        sql.exec(statement);
    } catch (error) {
        if (String(error).toLowerCase().includes("duplicate column")) {
            return;
        }

        throw error;
    }
}

function emptyResume(): ResumeAnalysis {
    return {
        basic: {
            email: "",
            name: "Unknown",
            phone: "",
            socialMedia: [],
        },
        edu: [],
        project: [],
        rawText: "",
        skills: [],
        work: [],
    };
}

function readUploadSource(value: string): UploadSource {
    return value === "drag" || value === "paste" ? value : "click";
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.slice(offset, offset + chunkSize),
        );
    }

    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

// Legacy classes retained so previously deployed migration tags continue to
// reference valid exports. New code and bindings use the RPC classes above.
export class ResumeObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        if (request.method === "PUT") {
            const resume = (await request.json()) as ResumeAnalysis;
            await this.ctx.storage.put(VALUE_KEY, resume);

            return Response.json({ ok: true });
        }

        const resume = await this.ctx.storage.get<ResumeAnalysis>(VALUE_KEY);

        if (!resume) {
            return Response.json(
                { error: "Resume not found" },
                { status: 404 },
            );
        }

        return Response.json({ resume });
    }
}

export class ResumeIndexObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        if (request.method === "PUT") {
            const { name } = (await request.json()) as { name: string };
            const ids = await this.readIds();

            if (!ids.includes(name)) {
                ids.push(name);
                await this.ctx.storage.put(IDS_KEY, ids);
            }

            return Response.json({ ok: true });
        }

        return Response.json({ ids: await this.readIds() });
    }

    private async readIds(): Promise<string[]> {
        return (await this.ctx.storage.get<string[]>(IDS_KEY)) ?? [];
    }
}

export class JobDescriptionObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        if (request.method === "PUT") {
            const jd = (await request.json()) as JobDescription;
            await this.ctx.storage.put(VALUE_KEY, jd);

            return Response.json({ ok: true });
        }

        const jd = await this.ctx.storage.get<JobDescription>(VALUE_KEY);

        if (!jd) {
            return Response.json({ error: "JD not found" }, { status: 404 });
        }

        return Response.json({ jd });
    }
}

export class JobDescriptionIndexObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        if (request.method === "PUT") {
            const { id } = (await request.json()) as { id: string };
            const ids = await this.readIds();

            if (!ids.includes(id)) {
                ids.push(id);
                await this.ctx.storage.put(IDS_KEY, ids);
            }

            return Response.json({ ok: true });
        }

        return Response.json({ ids: await this.readIds() });
    }

    private async readIds(): Promise<string[]> {
        return (await this.ctx.storage.get<string[]>(IDS_KEY)) ?? [];
    }
}
