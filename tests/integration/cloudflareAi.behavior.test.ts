import { describe, expect, it } from "vitest";
import {
    createCloudflareServices,
    type CloudflareEnv,
} from "../../src/backend/cf/services";
import { parseResumeAnalysis } from "../../src/shared/schemas";
import { sampleResume } from "../fixtures/sampleData";

type CapturedAiRun = {
    input: unknown;
    model: string;
    options: unknown;
};

class CapturingAi {
    readonly calls: CapturedAiRun[] = [];
    readonly gatewayCalls: unknown[] = [];
    readonly markdownCalls: Array<{ blob: Blob; name: string }> = [];

    async run(
        model: string,
        input: unknown,
        options?: unknown,
    ): Promise<unknown> {
        this.calls.push({ input, model, options });

        return {
            response: JSON.stringify(sampleResume),
        };
    }

    gateway(gatewayId: string): {
        run: (request: unknown, options?: unknown) => Promise<Response>;
    } {
        void gatewayId;

        return {
            run: async (request: unknown, options?: unknown) => {
                void request;
                void options;
                this.gatewayCalls.push(true);

                return new Response(
                    JSON.stringify({
                        candidates: [
                            {
                                content: {
                                    parts: [
                                        {
                                            text: JSON.stringify(sampleResume),
                                        },
                                    ],
                                    role: "model",
                                },
                                finishReason: "STOP",
                            },
                        ],
                    }),
                    {
                        headers: {
                            "content-type": "application/json",
                        },
                        status: 200,
                    },
                );
            },
        };
    }

    async toMarkdown(file: { blob: Blob; name: string }): Promise<unknown> {
        this.markdownCalls.push(file);

        return {
            data: "Kai Tan resume converted to markdown",
            format: "markdown",
            id: "converted-kai-tan",
            mimeType: "application/pdf",
            name: file.name,
            tokens: 8,
        };
    }
}

describe("Cloudflare Workers AI resume extraction", () => {
    it("converts uploaded PDFs to markdown before sending resume text to Gemini through AI Gateway", async () => {
        const ai = new CapturingAi();
        const services = createCloudflareServices({
            AI: ai as unknown as Ai,
            AI_GATEWAY_NAME: "collects-auto-ai",
            GEMINI_MODEL: "gemini-3.5-flash",
            JD_INDEX: {} as DurableObjectNamespace,
            JD_OBJECT: {} as DurableObjectNamespace,
            RESUME_ANALYSIS_QUEUE: {} as Queue,
            RESUME_DOCUMENT: {} as DurableObjectNamespace,
            RESUME_REGISTRY: {} as DurableObjectNamespace,
        } as CloudflareEnv);
        const bytes = new TextEncoder().encode("%PDF-1.7\nKai Tan resume");

        const resume = await services.ai.extractResume({
            bytes,
            fileName: "kai-tan.pdf",
            source: "drag",
        });

        expect(parseResumeAnalysis(resume).basic.name).toBe(
            sampleResume.basic.name,
        );
        expect(ai.markdownCalls).toHaveLength(1);
        expect(ai.calls).toHaveLength(0);
        expect(ai.gatewayCalls).toHaveLength(1);
    });
});
