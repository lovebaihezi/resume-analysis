import { DurableObject } from "cloudflare:workers";
import {
    contextMetadata,
    durationMs,
    logError,
    logInfo,
    OBSERVABILITY_OPERATION_HEADER,
    OBSERVABILITY_REQUEST_ID_HEADER,
    type ObservabilityContext,
} from "../observability";
import type { JobDescription, ResumeAnalysis } from "../../shared/types";

const VALUE_KEY = "value";
const IDS_KEY = "ids";

export class ResumeObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        return logDurableObjectRequest(
            "ResumeObject",
            this.ctx.id,
            request,
            async () => {
                if (request.method === "PUT") {
                    const resume = (await request.json()) as ResumeAnalysis;
                    await this.ctx.storage.put(VALUE_KEY, resume);

                    return Response.json({ ok: true });
                }

                const resume =
                    await this.ctx.storage.get<ResumeAnalysis>(VALUE_KEY);

                if (!resume) {
                    return Response.json(
                        { error: "Resume not found" },
                        { status: 404 },
                    );
                }

                return Response.json({ resume });
            },
        );
    }
}

export class ResumeIndexObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        return logDurableObjectRequest(
            "ResumeIndexObject",
            this.ctx.id,
            request,
            async () => {
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
            },
        );
    }

    private async readIds(): Promise<string[]> {
        return (await this.ctx.storage.get<string[]>(IDS_KEY)) ?? [];
    }
}

export class JobDescriptionObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        return logDurableObjectRequest(
            "JobDescriptionObject",
            this.ctx.id,
            request,
            async () => {
                if (request.method === "PUT") {
                    const jd = (await request.json()) as JobDescription;
                    await this.ctx.storage.put(VALUE_KEY, jd);

                    return Response.json({ ok: true });
                }

                const jd =
                    await this.ctx.storage.get<JobDescription>(VALUE_KEY);

                if (!jd) {
                    return Response.json(
                        { error: "JD not found" },
                        { status: 404 },
                    );
                }

                return Response.json({ jd });
            },
        );
    }
}

export class JobDescriptionIndexObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        return logDurableObjectRequest(
            "JobDescriptionIndexObject",
            this.ctx.id,
            request,
            async () => {
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
            },
        );
    }

    private async readIds(): Promise<string[]> {
        return (await this.ctx.storage.get<string[]>(IDS_KEY)) ?? [];
    }
}

async function logDurableObjectRequest(
    durableObject: string,
    durableObjectId: DurableObjectId,
    request: Request,
    handler: () => Promise<Response>,
): Promise<Response> {
    const startedAt = Date.now();
    const context = durableContext(request);
    const durableMetadata = {
        durable_method: request.method,
        durable_object: durableObject,
        durable_object_id: durableObjectId.toString(),
        durable_operation:
            request.headers.get(OBSERVABILITY_OPERATION_HEADER) ?? null,
    };

    logInfo(
        "durable.object.request.start",
        contextMetadata(context, durableMetadata),
    );

    try {
        const response = await handler();

        logInfo(
            "durable.object.request.complete",
            contextMetadata(context, {
                ...durableMetadata,
                duration_ms: durationMs(startedAt),
                status_code: response.status,
            }),
        );

        return response;
    } catch (error) {
        logError(
            "durable.object.request.failed",
            contextMetadata(context, {
                ...durableMetadata,
                duration_ms: durationMs(startedAt),
            }),
            error,
        );
        throw error;
    }
}

function durableContext(request: Request): ObservabilityContext | undefined {
    const requestId = request.headers.get(OBSERVABILITY_REQUEST_ID_HEADER);

    if (!requestId) {
        return undefined;
    }

    return {
        method: request.method,
        requestId,
        route: "durable-object",
    };
}
