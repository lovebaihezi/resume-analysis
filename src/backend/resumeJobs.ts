import type { AppServices, ResumeAnalysisJob } from "./ports";
import {
    contextMetadata,
    createRequestContext,
    durationMs,
    logError,
    logInfo,
    sha256Hex,
    type ObservabilityContext,
} from "./observability";

export const RESUME_ANALYSIS_MAX_ATTEMPTS = 3;

export async function processResumeAnalysisJob(
    services: AppServices,
    job: ResumeAnalysisJob,
): Promise<void> {
    const startedAt = Date.now();
    const context = queueContext(job);
    const pending = await services.resumeStore.getPendingUpload(
        job.resumeId,
        context,
    );

    if (!pending) {
        logInfo(
            "queue.resume_analysis.pending_missing",
            contextMetadata(context, {
                duration_ms: durationMs(startedAt),
                resume_id: job.resumeId,
            }),
        );
        return;
    }

    logInfo(
        "queue.resume_analysis.pending_loaded",
        contextMetadata(context, {
            duration_ms: durationMs(startedAt),
            file_name_sha256: await sha256Hex(pending.fileName),
            input_bytes: pending.bytes.byteLength,
            input_sha256: await sha256Hex(pending.bytes),
            resume_id: job.resumeId,
            upload_source: pending.source,
        }),
    );

    const extractionStartedAt = Date.now();
    const resume = await services.ai.extractResume(
        {
            bytes: pending.bytes,
            fileName: pending.fileName,
            source: pending.source,
        },
        context,
    );

    logInfo(
        "queue.resume_analysis.extract_complete",
        contextMetadata(context, {
            duration_ms: durationMs(extractionStartedAt),
            resume_id: job.resumeId,
        }),
    );

    const storeStartedAt = Date.now();
    await services.resumeStore.completePendingAnalysis(
        job.resumeId,
        resume,
        context,
    );
    logInfo(
        "queue.resume_analysis.store_complete",
        contextMetadata(context, {
            duration_ms: durationMs(storeStartedAt),
            resume_id: job.resumeId,
        }),
    );
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
        const context = queueContext(message.body);

        logInfo(
            "queue.resume_analysis.start",
            contextMetadata(context, {
                attempts: message.attempts,
                message_id: message.id,
                resume_id: message.body.resumeId,
            }),
        );

        try {
            await processResumeAnalysisJob(services, message.body);
            message.ack();
            logInfo(
                "queue.resume_analysis.ack",
                contextMetadata(context, {
                    attempts: message.attempts,
                    duration_ms: durationMs(startedAt),
                    message_id: message.id,
                    resume_id: message.body.resumeId,
                }),
            );
        } catch (error) {
            logError(
                "queue.resume_analysis.failed",
                contextMetadata(context, {
                    attempts: message.attempts,
                    duration_ms: durationMs(startedAt),
                    message_id: message.id,
                    resume_id: message.body.resumeId,
                }),
                error,
            );

            if (message.attempts >= RESUME_ANALYSIS_MAX_ATTEMPTS) {
                await services.resumeStore.failPendingAnalysis(
                    message.body.resumeId,
                    context,
                );
                message.ack();
                logError(
                    "queue.resume_analysis.failed_final",
                    contextMetadata(context, {
                        attempts: message.attempts,
                        duration_ms: durationMs(startedAt),
                        message_id: message.id,
                        resume_id: message.body.resumeId,
                    }),
                    error,
                );
                return;
            }

            message.retry({ delaySeconds: 10 * message.attempts });
            logInfo(
                "queue.resume_analysis.retry",
                contextMetadata(context, {
                    attempts: message.attempts,
                    delay_seconds: 10 * message.attempts,
                    duration_ms: durationMs(startedAt),
                    message_id: message.id,
                    resume_id: message.body.resumeId,
                }),
            );
        }
    }
}

function queueContext(job: ResumeAnalysisJob): ObservabilityContext {
    return createRequestContext({
        method: "QUEUE",
        requestId: job.requestId,
        route: "queue:resume-analysis",
    });
}
