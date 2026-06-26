import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import { createApiApp } from "./backend/expressApp";
import type { ResumeAnalysisJob } from "./backend/ports";
import { processResumeAnalysisQueueBatch } from "./backend/resumeJobs";
import {
    JobDescriptionIndexObject,
    JobDescriptionObject,
    ResumeDocumentObject,
    ResumeIndexObject,
    ResumeObject,
    ResumeRegistryObject,
} from "./backend/cf/durableObjects";
import {
    createCloudflareServices,
    type CloudflareEnv,
} from "./backend/cf/services";

export {
    JobDescriptionIndexObject,
    JobDescriptionObject,
    ResumeDocumentObject,
    ResumeIndexObject,
    ResumeObject,
    ResumeRegistryObject,
};

const app = createApiApp(createCloudflareServices(env as CloudflareEnv));

app.listen(3000);

const httpHandler = httpServerHandler({ port: 3000 });

export default {
    async fetch(request, requestEnv, ctx) {
        if (!httpHandler.fetch) {
            return new Response("HTTP handler unavailable", { status: 500 });
        }

        return httpHandler.fetch(request, requestEnv, ctx);
    },
    async queue(batch, queueEnv, _ctx) {
        await processResumeAnalysisQueueBatch(
            createCloudflareServices(queueEnv as CloudflareEnv),
            batch,
        );
    },
} satisfies ExportedHandler<CloudflareEnv, ResumeAnalysisJob>;
