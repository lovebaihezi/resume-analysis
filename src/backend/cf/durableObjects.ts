import { DurableObject } from "cloudflare:workers";
import type { JobDescription, ResumeAnalysis } from "../../shared/types";

const VALUE_KEY = "value";
const IDS_KEY = "ids";

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
