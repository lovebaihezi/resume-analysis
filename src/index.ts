import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import { createApiApp } from "./backend/expressApp";
import {
    JobDescriptionIndexObject,
    JobDescriptionObject,
    ResumeIndexObject,
    ResumeObject,
} from "./backend/cf/durableObjects";
import {
    createCloudflareServices,
    type CloudflareEnv,
} from "./backend/cf/services";

export {
    JobDescriptionIndexObject,
    JobDescriptionObject,
    ResumeIndexObject,
    ResumeObject,
};

const app = createApiApp(createCloudflareServices(env as CloudflareEnv));

app.listen(3000);

export default httpServerHandler({ port: 3000 });
