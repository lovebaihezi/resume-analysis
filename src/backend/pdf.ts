export const MAX_RESUME_PDF_PAGES = 3;

export class PdfPageLimitError extends Error {
    readonly code: "too_many_pages" | "unknown_page_count";

    constructor(code: PdfPageLimitError["code"], message: string) {
        super(message);
        this.code = code;
        this.name = "PdfPageLimitError";
    }
}

export function assertResumePdfPageLimit(
    bytes: Uint8Array,
    maxPages = MAX_RESUME_PDF_PAGES,
): number {
    const pageCount = countPdfPages(bytes);

    if (pageCount < 1) {
        throw new PdfPageLimitError(
            "unknown_page_count",
            "Could not determine PDF page count",
        );
    }

    if (pageCount > maxPages) {
        throw new PdfPageLimitError(
            "too_many_pages",
            `Resume PDFs must be ${maxPages} pages or fewer`,
        );
    }

    return pageCount;
}

export function countPdfPages(bytes: Uint8Array): number {
    const directPageObjects = countDirectPageObjects(bytes);

    if (directPageObjects > 0) {
        return directPageObjects;
    }

    return findLargestPageTreeCount(bytes);
}

function countDirectPageObjects(bytes: Uint8Array): number {
    let count = 0;

    for (let index = 0; index < bytes.length; index += 1) {
        if (!matchesAscii(bytes, index, "/Type")) {
            continue;
        }

        let cursor = index + "/Type".length;

        if (!isPdfWhitespace(bytes[cursor])) {
            continue;
        }

        while (isPdfWhitespace(bytes[cursor])) {
            cursor += 1;
        }

        if (
            matchesAscii(bytes, cursor, "/Page") &&
            isPdfDelimiter(bytes[cursor + "/Page".length])
        ) {
            count += 1;
        }
    }

    return count;
}

function findLargestPageTreeCount(bytes: Uint8Array): number {
    let largest = 0;

    for (let index = 0; index < bytes.length; index += 1) {
        if (!matchesAscii(bytes, index, "/Count")) {
            continue;
        }

        let cursor = index + "/Count".length;

        if (!isPdfWhitespace(bytes[cursor])) {
            continue;
        }

        while (isPdfWhitespace(bytes[cursor])) {
            cursor += 1;
        }

        let value = 0;

        while (isDigit(bytes[cursor])) {
            value = value * 10 + ((bytes[cursor] ?? 48) - 48);
            cursor += 1;
        }

        largest = Math.max(largest, value);
    }

    return largest;
}

function matchesAscii(
    bytes: Uint8Array,
    offset: number,
    value: string,
): boolean {
    if (offset + value.length > bytes.length) {
        return false;
    }

    for (let index = 0; index < value.length; index += 1) {
        if (bytes[offset + index] !== value.charCodeAt(index)) {
            return false;
        }
    }

    return true;
}

function isDigit(byte: number | undefined): boolean {
    return byte !== undefined && byte >= 48 && byte <= 57;
}

function isPdfWhitespace(byte: number | undefined): boolean {
    return (
        byte === 0 ||
        byte === 9 ||
        byte === 10 ||
        byte === 12 ||
        byte === 13 ||
        byte === 32
    );
}

function isPdfDelimiter(byte: number | undefined): boolean {
    return (
        byte === undefined ||
        isPdfWhitespace(byte) ||
        byte === 37 ||
        byte === 40 ||
        byte === 41 ||
        byte === 47 ||
        byte === 60 ||
        byte === 62 ||
        byte === 91 ||
        byte === 93 ||
        byte === 123 ||
        byte === 125
    );
}
