import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2] ?? "src/frontend";
const anchorPattern = /<a\b[^>]*>/g;

export async function lintXStateLinks(target = root) {
    const files = await collectFiles(target);
    const sources = await Promise.all(
        files.map(async (file) => [file, await readFile(file, "utf8")]),
    );
    const failures = [];

    for (const [file, source] of sources) {
        const anchors = source.matchAll(anchorPattern);

        for (const match of anchors) {
            const tag = match[0];

            if (
                !/\bhref=/.test(tag) ||
                /\bdata-xstate-link=/.test(tag) ||
                /\bdata-xstate-ignore=/.test(tag)
            ) {
                continue;
            }

            failures.push(
                `${file}: raw <a href> must use AppLink or data-xstate-ignore`,
            );
        }
    }

    return failures;
}

async function collectFiles(target) {
    const statTarget = path.resolve(target);
    const entries = await readdir(statTarget, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(statTarget, entry.name);

            if (entry.isDirectory()) {
                return collectFiles(entryPath);
            }

            if (/\.[jt]sx$/.test(entry.name)) {
                return [entryPath];
            }

            return [];
        }),
    );

    return nested.flat();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const failures = await lintXStateLinks();

    if (failures.length > 0) {
        console.error(failures.join("\n"));
        process.exit(1);
    }
}
