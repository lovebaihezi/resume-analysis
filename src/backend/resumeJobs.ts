import type { AppServices, ResumeAnalysisJob } from "./ports";

export const RESUME_ANALYSIS_MAX_ATTEMPTS = 3;

export async function processResumeAnalysisJob(
    services: AppServices,
    job: ResumeAnalysisJob,
): Promise<void> {
    const startedAt = Date.now();
    const pending = await services.resumeStore.getPendingUpload(job.resumeId);

    if (!pending) {
        console.info("resume-analysis-queue", {
            durationMs: elapsed(startedAt),
            event: "job:pending-missing",
            resumeId: job.resumeId,
        });
        return;
    }

    console.info("resume-analysis-queue", {
        bytes: pending.bytes.byteLength,
        durationMs: elapsed(startedAt),
        event: "job:pending-loaded",
        fileName: pending.fileName,
        resumeId: job.resumeId,
        source: pending.source,
    });

    const extractionStartedAt = Date.now();
    const resume = await services.ai.extractResume({
        bytes: pending.bytes,
        fileName: pending.fileName,
        source: pending.source,
    });

    console.info("resume-analysis-queue", {
        durationMs: elapsed(extractionStartedAt),
        event: "job:extract-complete",
        resumeId: job.resumeId,
    });

    const storeStartedAt = Date.now();
    await services.resumeStore.completePendingAnalysis(job.resumeId, resume);
    console.info("resume-analysis-queue", {
        durationMs: elapsed(storeStartedAt),
        event: "job:store-complete",
        resumeId: job.resumeId,
    });
}

export async function processResumeAnalysisQueueBatch(
    services: AppServices,
    batch: MessageBatch<ResumeAnalysisJob>,
): Promise<void> {
    await Promise.all(batch.messages.map((message) => processMessage(message)));

    async function processMessage(
        message: Message<ResumeAnalysisJob>,
    ): Promise<void> {
        const startedAt = Date.now();

        console.info("resume-analysis-queue", {
            attempts: message.attempts,
            event: "job:start",
            resumeId: message.body.resumeId,
        });

        try {
            await processResumeAnalysisJob(services, message.body);
            message.ack();
            console.info("resume-analysis-queue", {
                attempts: message.attempts,
                durationMs: elapsed(startedAt),
                event: "job:ack",
                resumeId: message.body.resumeId,
            });
        } catch (error) {
            console.error("Resume analysis job failed", {
                attempts: message.attempts,
                durationMs: elapsed(startedAt),
                error: errorMessage(error),
                resumeId: message.body.resumeId,
            });

            if (message.attempts >= RESUME_ANALYSIS_MAX_ATTEMPTS) {
                await services.resumeStore.failPendingAnalysis(
                    message.body.resumeId,
                );
                message.ack();
                console.error("resume-analysis-queue", {
                    attempts: message.attempts,
                    durationMs: elapsed(startedAt),
                    event: "job:failed-final",
                    resumeId: message.body.resumeId,
                });
                return;
            }

            message.retry({ delaySeconds: 10 * message.attempts });
            console.info("resume-analysis-queue", {
                attempts: message.attempts,
                delaySeconds: 10 * message.attempts,
                durationMs: elapsed(startedAt),
                event: "job:retry",
                resumeId: message.body.resumeId,
            });
        }
    }
}

function elapsed(startedAt: number): number {
    return Date.now() - startedAt;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
