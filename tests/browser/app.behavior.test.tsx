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
import { afterEach, describe, expect, it, vi } from "vitest";
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
        const firstResumeLink = await within(nav).findByRole("link", {
            name: /uploaded resumes/i,
        });
        const firstJdLink = within(nav).getByRole("link", {
            name: /jd editor/i,
        });

        expect(firstResumeLink).toBeDefined();
        expect(firstJdLink).toBeDefined();
        expect(within(nav).queryByText(/uploaded resumes/i)).toBeNull();
        expect(within(nav).queryByText(/jd editor/i)).toBeNull();
        await waitFor(() => {
            expect(within(firstResumeLink).getByText("1")).toHaveClass("badge");
        });
        expect(firstResumeLink).toHaveAttribute("href", "/resumes");
        expect(firstJdLink).toHaveAttribute("href", "/jd");
    });

    it("uploads a PDF from click selection, shows progress, and routes to the id-based detail page", async () => {
        await resetBackend();
        const user = userEvent.setup();
        renderApp("/");
        const file = new File([pdfWithPages(1, "Ava Chen")], "ava-chen.pdf", {
            type: "application/pdf",
        });

        await user.upload(screen.getByLabelText(/choose resume pdf/i), file);

        await waitFor(() => {
            expect(window.location.pathname).toMatch(/^\/resumes\/.+/);
        });
        await waitFor(() => {
            expect(document.body).toHaveTextContent(/100%/);
        });
        expect(
            await screen.findByText("Ava Chen", { selector: "p" }),
        ).toBeInTheDocument();
        await expectStoredResumeVisibleAfterRefresh("Ava Chen");
    });

    it("opens the file picker from the whole upload drop zone", async () => {
        await resetBackend();
        const user = userEvent.setup();
        renderApp("/");
        const input = screen.getByLabelText(/choose resume pdf/i);
        const clickSpy = vi.spyOn(input, "click");

        try {
            await user.click(screen.getByTestId("resume-dropzone"));

            expect(clickSpy).toHaveBeenCalledOnce();
        } finally {
            clickSpy.mockRestore();
        }
    });

    it("hides the progress bar until a PDF upload is active", async () => {
        await resetBackend();
        renderApp("/");

        expect(screen.queryByRole("progressbar")).toBeNull();
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
        expect(screen.getByText(/analyzing resume/i)).toBeInTheDocument();
        expect(window.location.pathname).toBe("/");
    });

    it("links resume table rows by resumeId while displaying the extracted name", async () => {
        await resetBackend({ seedResume: true });
        renderApp("/resumes");

        const link = await screen.findByRole("link", { name: "Ava Chen" });

        expect(link).toHaveAttribute(
            "href",
            expect.stringMatching(
                /^\/resumes\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            ),
        );
    });

    it("archives a resume from the uploaded resume table", async () => {
        await resetBackend({ seedResume: true });
        const user = userEvent.setup();
        renderApp("/resumes");

        expect(await screen.findByText("1 total")).toBeInTheDocument();
        await user.click(
            await screen.findByRole("button", { name: /archive ava chen/i }),
        );

        await waitFor(() => {
            expect(
                screen.queryByRole("link", { name: "Ava Chen" }),
            ).not.toBeInTheDocument();
        });
        expect(await screen.findByText("0 total")).toBeInTheDocument();
        expect(screen.getByText("No resumes uploaded.")).toBeInTheDocument();
    });

    it("uses an icon-only 404 state for missing resume details", async () => {
        await resetBackend();
        renderApp("/resumes/missing");

        expect(
            await screen.findByRole("img", { name: /404 error/i }),
        ).toBeInTheDocument();
        expect(screen.queryByText(/resume not found/i)).toBeNull();
    });

    it("uploads PDFs from drag and paste interactions", async () => {
        await resetBackend();
        renderApp("/");
        const file = new File([pdfWithPages(1, "Ava Chen")], "ava-chen.pdf", {
            type: "application/pdf",
        });
        const zone = screen.getByTestId("resume-dropzone");

        await act(async () => {
            fireEvent(zone, dropEvent(file));
        });

        await waitFor(() => {
            expect(window.location.pathname).toMatch(/^\/resumes\/.+/);
        });
        expect(
            await screen.findByText("Ava Chen", { selector: "p" }),
        ).toBeInTheDocument();
        await expectStoredResumeVisibleAfterRefresh("Ava Chen");

        cleanup();
        window.history.replaceState(null, "", "/");
        await resetBackend();
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

        await waitFor(() => {
            expect(window.location.pathname).toMatch(/^\/resumes\/.+/);
        });
        expect(
            await screen.findByText("Ava Chen", { selector: "p" }),
        ).toBeInTheDocument();
        await expectStoredResumeVisibleAfterRefresh("Ava Chen");
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
        expect(window.location.pathname).toBe("/");
        expect(screen.queryByRole("progressbar")).toBeNull();
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

async function expectStoredResumeVisibleAfterRefresh(name: string) {
    const resumeDetailPath = window.location.pathname;

    expect(resumeDetailPath).toMatch(/^\/resumes\/.+/);

    cleanup();
    window.history.replaceState(null, "", resumeDetailPath);
    renderApp(resumeDetailPath);

    expect(
        await screen.findByText(name, { selector: "p" }),
    ).toBeInTheDocument();
}

type BackendState = {
    mode: "auto" | "pending";
};

async function resetBackend(
    options: {
        mode?: BackendState["mode"];
        seedResume?: boolean;
    } = {},
): Promise<void> {
    const params = new URLSearchParams({
        mode: options.mode ?? "auto",
        seedResume: String(options.seedResume ?? false),
    });
    const response = await fetch(`/__test/reset?${params}`, {
        method: "POST",
    });

    expect(response.ok).toBe(true);
}
