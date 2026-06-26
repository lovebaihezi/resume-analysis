export type LogScalar = string | number | boolean | null | undefined;
export type LogMetadata = Record<string, LogScalar>;

export type ObservabilityContext = {
    requestId: string;
    method?: string;
    route?: string;
};

const SERVICE_NAME = "resume-analyze";
export const REQUEST_ID_HEADER = "x-request-id";
export const OBSERVABILITY_REQUEST_ID_HEADER = "x-observability-request-id";
export const OBSERVABILITY_OPERATION_HEADER = "x-observability-operation";

export function createRequestContext(input: {
    method?: string;
    requestId?: string;
    route?: string;
}): ObservabilityContext {
    return {
        method: input.method,
        requestId: cleanRequestId(input.requestId) ?? crypto.randomUUID(),
        route: input.route,
    };
}

export function contextMetadata(
    context: ObservabilityContext | undefined,
    metadata: LogMetadata = {},
): LogMetadata {
    return compactMetadata({
        method: context?.method,
        request_id: context?.requestId,
        route: context?.route,
        ...metadata,
    });
}

export function durationMs(startedAt: number): number {
    return Date.now() - startedAt;
}

export function gatewayMetadata(
    context: ObservabilityContext | undefined,
    input: {
        inputKind: string;
        task: string;
    },
): Record<string, string | number | boolean | null> {
    return compactGatewayMetadata({
        app: SERVICE_NAME,
        input_kind: input.inputKind,
        request_id: context?.requestId ?? null,
        route: context?.route ?? null,
        task: input.task,
    });
}

export function logInfo(event: string, metadata: LogMetadata = {}): void {
    writeLog("info", event, metadata);
}

export function logError(
    event: string,
    metadata: LogMetadata = {},
    error?: unknown,
): void {
    writeLog("error", event, {
        ...metadata,
        ...errorMetadata(error),
    });
}

export function requestHeaders(
    context: ObservabilityContext | undefined,
    operation: string,
): Headers {
    const headers = new Headers();

    if (context?.requestId) {
        headers.set(OBSERVABILITY_REQUEST_ID_HEADER, context.requestId);
    }

    headers.set(OBSERVABILITY_OPERATION_HEADER, operation);

    return headers;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
    const bytes =
        typeof input === "string" ? new TextEncoder().encode(input) : input;
    const source = new Uint8Array(bytes.byteLength);

    source.set(bytes);

    const hash = await crypto.subtle.digest("SHA-256", source);

    return [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function cleanRequestId(value: string | undefined): string | undefined {
    const trimmed = value?.trim();

    if (!trimmed || trimmed.length > 128) {
        return undefined;
    }

    return trimmed;
}

function compactGatewayMetadata(
    metadata: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null> {
    return Object.fromEntries(
        Object.entries(metadata).filter(
            (entry): entry is [string, string | number | boolean | null] =>
                entry[1] !== undefined,
        ),
    );
}

function compactMetadata(metadata: LogMetadata): LogMetadata {
    return Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
    );
}

function errorMetadata(error: unknown): LogMetadata {
    if (error instanceof Error) {
        return {
            error_message: error.message,
            error_name: error.name,
            error_stack: error.stack,
        };
    }

    if (error === undefined) {
        return {};
    }

    return {
        error_message: String(error),
        error_name: "NonError",
    };
}

function writeLog(
    level: "error" | "info",
    event: string,
    metadata: LogMetadata,
): void {
    const record = compactMetadata({
        event,
        level,
        service: SERVICE_NAME,
        timestamp: new Date().toISOString(),
        ...metadata,
    });
    const line = JSON.stringify(record);

    if (level === "error") {
        console.error(line);
        return;
    }

    console.log(line);
}
