import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/frontend/App";

describe("resume analysis UI behavior", () => {
    afterEach(() => {
        cleanup();
        window.history.replaceState(null, "", "/");
    });

    it("renders the responsive DaisyUI navbar and XState-owned links", async () => {
        await resetBackend({ seedResume: true });
        renderApp("/");

        const nav = screen.getByRole("navigation", { name: /primary/i });
        expect(
            within(nav).getByRole("link", { name: /resume analysis/i }),
        ).toBeInTheDocument();
        const resumeLinks =
            await within(nav).findAllByText(/uploaded resumes/i);
        const firstResumeLink = resumeLinks[0];
        const firstJdLink = within(nav).getAllByText(/jd editor/i)[0];

        expect(firstResumeLink).toBeDefined();
        expect(firstJdLink).toBeDefined();
        await waitFor(() => {
            expect(within(nav).getAllByText("1")[0]).toHaveClass("badge");
        });
        expect(firstResumeLink?.closest("a")).toHaveAttribute(
            "href",
            "/resumes",
        );
        expect(firstJdLink?.closest("a")).toHaveAttribute("href", "/jd");
    });

    it("uploads a PDF from click selection, shows progress, and routes to the id-based detail page", async () => {
        await resetBackend();
        const user = userEvent.setup();
        renderApp("/");
        const file = new File([pdfWithPages(1, "Ava Chen")], "ava-chen.pdf", {
            type: "application/pdf",
        });

        await user.upload(screen.getByLabelText(/choose resume pdf/i), file);

        await waitFor(async () => {
            expect((await readBackendState()).sources).toEqual(["click"]);
        });
        await waitFor(() => {
            expect(window.location.pathname).toMatch(/^\/resumes\/.+/);
        });
        expect(await screen.findByText(/raw resume/i)).toBeInTheDocument();
        await waitFor(() => {
            expect(document.body).toHaveTextContent(/100%/);
        });
        expect(
            screen.getByText("Ava Chen", { selector: "p" }),
        ).toBeInTheDocument();
    });

    it("shows a resume extraction skeleton while the queued analysis is pending", async () => {
        await resetBackend({ mode: "pending" });
        const user = userEvent.setup();
        renderApp("/");
        const file = new File([pdfWithPages(1, "Ava Chen")], "ava-chen.pdf", {
            type: "application/pdf",
        });

        await user.upload(screen.getByLabelText(/choose resume pdf/i), file);

        expect(
            await screen.findByTestId("resume-extraction-skeleton"),
        ).toBeInTheDocument();
        expect(screen.getByText("ava-chen.pdf")).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: /extracting resume/i }),
        ).toBeInTheDocument();
        expect(window.location.pathname).toBe("/");
    });

    it("links resume table rows by resumeId while displaying the extracted name", async () => {
        const state = await resetBackend({ seedResume: true });
        renderApp("/resumes");

        const link = await screen.findByRole("link", { name: "Ava Chen" });

        expect(link).toHaveAttribute("href", `/resumes/${state.seedResumeId}`);
    });

    it("tracks drag and paste upload sources separately", async () => {
        await resetBackend();
        renderApp("/");
        const file = new File([pdfWithPages(1, "Ava Chen")], "ava-chen.pdf", {
            type: "application/pdf",
        });
        const zone = screen.getByTestId("resume-dropzone");

        await act(async () => {
            fireEvent(zone, dropEvent(file));
        });

        await waitFor(async () => {
            expect((await readBackendState()).sources).toContain("drag");
        });

        cleanup();
        window.history.replaceState(null, "", "/");
        renderApp("/");

        const pasted = new ClipboardEvent("paste", { bubbles: true });
        Object.defineProperty(pasted, "clipboardData", {
            value: {
                files: [file],
            },
        });
        await act(async () => {
            window.dispatchEvent(pasted);
        });

        await waitFor(async () => {
            expect((await readBackendState()).sources).toEqual([
                "drag",
                "paste",
            ]);
        });
    });

    it("rejects non-PDF files in the upload surface before calling the API", async () => {
        await resetBackend();
        renderApp("/");
        const file = new File(["hello"], "resume.txt", { type: "text/plain" });
        const zone = screen.getByTestId("resume-dropzone");

        await act(async () => {
            fireEvent(zone, dropEvent(file));
        });

        expect(await screen.findByText(/pdf files only/i)).toBeInTheDocument();
        expect((await readBackendState()).sources).toEqual([]);
    });

    it("submits a raw JD and displays structured AI output", async () => {
        await resetBackend();
        const user = userEvent.setup();
        renderApp("/jd");

        await user.type(
            screen.getByLabelText(/job description/i),
            "Senior frontend engineer with React and Cloudflare Workers experience.",
        );
        await user.click(screen.getByRole("button", { name: /analyze jd/i }));

        expect(
            await screen.findByRole("heading", {
                name: /senior frontend engineer/i,
            }),
        ).toBeInTheDocument();
        expect(screen.getAllByText(/^React$/).length).toBeGreaterThan(0);
        expect(
            screen.getAllByText(/^Cloudflare Workers$/).length,
        ).toBeGreaterThan(0);
    });
});

function dropEvent(file: File): Event {
    const event = new Event("drop", { bubbles: true });

    Object.defineProperty(event, "dataTransfer", {
        value: {
            files: [file],
        },
    });

    return event;
}

function pdfWithPages(pageCount: number, label = "Resume"): string {
    const kids = Array.from(
        { length: pageCount },
        (_, index) => `${index + 3} 0 R`,
    ).join(" ");
    const pageObjects = Array.from({ length: pageCount }, (_, index) => {
        const objectId = index + 3;

        return `${objectId} 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj`;
    }).join("\n");

    return `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>
endobj
${pageObjects}
% ${label}
trailer
<< /Root 1 0 R >>
%%EOF`;
}

function renderApp(initialEntry: string): void {
    render(
        <SWRConfig value={{ provider: () => new Map() }}>
            <App initialEntries={[initialEntry]} />
        </SWRConfig>,
    );
}

type BackendState = {
    mode: "auto" | "pending";
    queuedJobs: Array<{ resumeId: string }>;
    resumeCount: number;
    seedResumeId?: string;
    sources: string[];
};

async function resetBackend(
    options: {
        mode?: BackendState["mode"];
        seedResume?: boolean;
    } = {},
): Promise<BackendState> {
    const params = new URLSearchParams({
        mode: options.mode ?? "auto",
        seedResume: String(options.seedResume ?? false),
    });
    const response = await fetch(`/__test/reset?${params}`, {
        method: "POST",
    });

    expect(response.ok).toBe(true);

    return (await response.json()) as BackendState;
}

async function readBackendState(): Promise<BackendState> {
    const response = await fetch("/__test/state");

    expect(response.ok).toBe(true);

    return (await response.json()) as BackendState;
}
