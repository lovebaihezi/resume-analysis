let lastTimestamp = 0;
let lastSequence = 0;

export function createResumeId(now = Date.now()): string {
    if (!globalThis.crypto?.getRandomValues) {
        return globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
    }

    const random = new Uint8Array(10);
    globalThis.crypto.getRandomValues(random);

    let timestamp = Math.max(now, lastTimestamp);
    let sequence =
        timestamp === lastTimestamp
            ? lastSequence + 1
            : (((random[0] ?? 0) << 4) | ((random[1] ?? 0) >> 4)) & 0x0fff;

    if (sequence > 0x0fff) {
        timestamp = lastTimestamp + 1;
        sequence = 0;
    }

    lastTimestamp = timestamp;
    lastSequence = sequence;

    const bytes = new Uint8Array(16);
    bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff;
    bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff;
    bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff;
    bytes[3] = Math.floor(timestamp / 0x10000) & 0xff;
    bytes[4] = Math.floor(timestamp / 0x100) & 0xff;
    bytes[5] = timestamp & 0xff;
    bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
    bytes[7] = sequence & 0xff;
    bytes[8] = ((random[2] ?? 0) & 0x3f) | 0x80;
    bytes[9] = random[3] ?? 0;
    bytes[10] = random[4] ?? 0;
    bytes[11] = random[5] ?? 0;
    bytes[12] = random[6] ?? 0;
    bytes[13] = random[7] ?? 0;
    bytes[14] = random[8] ?? 0;
    bytes[15] = random[9] ?? 0;

    return formatUuid(bytes);
}

function formatUuid(bytes: Uint8Array): string {
    const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
        12,
        16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fallbackUuid(): string {
    return "00000000-0000-7000-8000-000000000000";
}
