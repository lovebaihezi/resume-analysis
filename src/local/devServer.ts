import express from "express";
import { createServer as createViteServer } from "vite";
import { createApiApp } from "../backend/expressApp";
import { createTestServices } from "../backend/testImpl";

const port = Number(process.env.PORT ?? 5173);
const app = express();

async function main(): Promise<void> {
    const vite = await createViteServer({
        appType: "spa",
        server: {
            middlewareMode: true,
        },
    });

    app.use(createApiApp(createTestServices()));
    app.use(vite.middlewares);

    app.listen(port, () => {
        console.log(`Local simulated app: http://localhost:${port}`);
    });
}

void main();
