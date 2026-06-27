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
        vi.useRealTimers();
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
        const file = new File([pdfWithPages(1, "Asuka")], "asuka.pdf", {
            type: "application/pdf",
        });

        await user.upload(screen.getByLabelText(/choose resume pdf/i), file);

        await waitFor(() => {
            expect(window.location.pathname).toMatch(/^\/resumes\/.+/);
        });
        await waitFor(() => {
            expect(document.body).toHaveTextContent(/100%/);
        });
        await expectResumeDetailVisible("Asuka");
        await expectResumeDetailVisibleAfterRefresh("Asuka");
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

    it("shows streaming extraction status and field tokens before completion", async () => {
        await resetBackend({ mode: "pending" });
        const user = userEvent.setup();
        renderApp("/");
        const file = new File([pdfWithPages(1, "Asuka")], "asuka.pdf", {
            type: "application/pdf",
        });

        await user.upload(screen.getByLabelText(/choose resume pdf/i), file);

        expect(
            await screen.findByTestId("resume-extraction-skeleton"),
        ).toBeInTheDocument();
        expect(screen.getByText("asuka.pdf")).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: /extracting resume/i }),
        ).toBeInTheDocument();
        expect(
            await screen.findByText(/converting pdf to markdown/i),
        ).toBeInTheDocument();
        expect(
            await screen.findByText(/extracting content from markdown/i),
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText("Uploaded PDF preview"),
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText("First page PDF preview"),
        ).toBeInTheDocument();
        expect(
            screen.queryByText("Click, drag, or paste a PDF resume."),
        ).toBeNull();
        expect(
            screen.queryByRole("button", {
                name: /resume pdf upload area/i,
            }),
        ).toBeNull();
        expect(
            screen.getByLabelText("Converting PDF to markdown complete"),
        ).toBeInTheDocument();
        expect(
            await screen.findByLabelText("Converting PDF to markdown duration"),
        ).toHaveTextContent(/^(?:\d+ms|\d+\.\d+s)$/);
        const tokenRow = await screen.findByLabelText(
            "basic.name assigned Asuka",
        );

        expect(tokenRow).toBeInTheDocument();
        expect(tokenRow.querySelector(".katex")).toBeTruthy();
        expect(
            tokenRow.querySelector(".katex-mathml annotation")?.textContent,
        ).toBe(String.raw`\mathrm{basic.name} \rightarrow \text{Asuka}`);
        expect(window.location.pathname).toBe("/");
    });

    it("opens resume details from the uploaded resume table and preserves them after refresh", async () => {
        await resetBackend({ seedResume: true });
        const user = userEvent.setup();
        renderApp("/resumes");

        const link = await screen.findByRole("link", { name: "Asuka" });

        await user.click(link);
        await waitFor(() => {
            expect(window.location.pathname).toMatch(/^\/resumes\/.+/);
        });
        await expectResumeDetailVisible("Asuka");
        await expectResumeDetailVisibleAfterRefresh("Asuka");
    });

    it("filters the uploaded resume virtual list with one search system", async () => {
        await resetBackend({ seedResumeCount: 40 });
        const user = userEvent.setup();
        renderApp("/resumes");

        const search = await screen.findByRole("searchbox", {
            name: /search resumes/i,
        });

        expect(await screen.findByText("40 total")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Asuka" })).toBeVisible();
        expect(
            screen.queryByRole("link", { name: "Candidate 39" }),
        ).not.toBeInTheDocument();

        await user.type(search, "candidate 39");

        expect(await screen.findByText("1 of 40 shown")).toBeInTheDocument();
        expect(
            await screen.findByRole("link", { name: "Candidate 39" }),
        ).toBeVisible();
        expect(
            screen.queryByRole("link", { name: "Asuka" }),
        ).not.toBeInTheDocument();

        await user.clear(search);
        expect(await screen.findByText("40 total")).toBeInTheDocument();

        const virtualList = await screen.findByTestId("resume-virtual-list");

        virtualList.scrollTop = 3_200;
        fireEvent.scroll(virtualList);

        expect(
            await screen.findByRole("link", { name: "Candidate 39" }),
        ).toBeVisible();
    });

    it("archives a resume from the uploaded resume table", async () => {
        await resetBackend({ seedResume: true });
        const user = userEvent.setup();
        renderApp("/resumes");

        expect(await screen.findByText("1 total")).toBeInTheDocument();
        await user.click(
            await screen.findByRole("button", { name: /archive asuka/i }),
        );

        await waitFor(() => {
            expect(
                screen.queryByRole("link", { name: "Asuka" }),
            ).not.toBeInTheDocument();
        });
        await expectNoResumesVisible();

        reloadCurrentPage();
        await expectNoResumesVisible();
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
        const file = new File([pdfWithPages(1, "Asuka")], "asuka.pdf", {
            type: "application/pdf",
        });
        const zone = screen.getByTestId("resume-dropzone");

        await act(async () => {
            fireEvent(zone, dropEvent(file));
        });

        await waitFor(() => {
            expect(window.location.pathname).toMatch(/^\/resumes\/.+/);
        });
        await expectResumeDetailVisible("Asuka");
        await expectResumeDetailVisibleAfterRefresh("Asuka");

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
        await expectResumeDetailVisible("Asuka");
        await expectResumeDetailVisibleAfterRefresh("Asuka");
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

        await user.click(screen.getByRole("button", { name: /add jd/i }));
        await user.type(
            screen.getByLabelText(/paste jd text/i),
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

    it("fills a JD, selects an uploaded resume, advances match progress, and displays five-dimension results", async () => {
        await resetBackend({ seedResume: true });
        const user = userEvent.setup();
        renderApp("/jd");

        await user.click(screen.getByRole("button", { name: /add jd/i }));
        await user.type(
            screen.getByLabelText(/paste jd text/i),
            "Senior frontend engineer with React, XState, Cloudflare Workers, and accessibility ownership.",
        );
        await user.click(screen.getByRole("button", { name: /analyze jd/i }));
        expect(
            await screen.findByRole("heading", {
                name: /senior frontend engineer/i,
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /match resume/i }),
        ).toBeDisabled();

        const resumeSelector = await screen.findByLabelText(/^resume$/i);
        const resumeOption = await screen.findByRole("option", {
            name: "Asuka",
        });

        await user.selectOptions(resumeSelector, resumeOption);
        expect(
            screen.getByRole("button", { name: /match resume/i }),
        ).toBeEnabled();

        vi.useFakeTimers();
        fireEvent.click(screen.getByRole("button", { name: /match resume/i }));

        const progress = screen.getByRole("progressbar", {
            name: /match analysis progress/i,
        }) as HTMLProgressElement;
        const initialProgress = progress.value;

        await act(async () => {
            vi.advanceTimersByTime(320);
        });
        expect(progress.value).toBeGreaterThan(initialProgress);

        await act(async () => {
            vi.advanceTimersByTime(1_000);
            await Promise.resolve();
        });
        vi.useRealTimers();

        const result = await screen.findByRole("region", {
            name: /ai match result/i,
        });

        expect(
            within(result).getByLabelText(/resume match radar chart/i),
        ).toBeInTheDocument();
        expect(within(result).getAllByText("Edu").length).toBeGreaterThan(0);
        expect(within(result).getAllByText("Project").length).toBeGreaterThan(
            0,
        );
        expect(within(result).getAllByText("Work").length).toBeGreaterThan(0);
        expect(within(result).getAllByText("Skill").length).toBeGreaterThan(0);
        expect(within(result).getAllByText("Overall").length).toBeGreaterThan(
            0,
        );
        expect(within(result).getByText("5.0 / 5")).toBeInTheDocument();
        expect(result).toHaveTextContent(/Advantages:/);
        expect(result).toHaveTextContent(/Disadvantages:/);
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

async function expectResumeDetailVisible(name: string): Promise<void> {
    expect(
        await screen.findByText(name, { selector: "p" }),
    ).toBeInTheDocument();
}

async function expectResumeDetailVisibleAfterRefresh(
    name: string,
): Promise<void> {
    const resumeDetailPath = window.location.pathname;

    expect(resumeDetailPath).toMatch(/^\/resumes\/.+/);
    reloadCurrentPage();
    await expectResumeDetailVisible(name);
}

async function expectNoResumesVisible(): Promise<void> {
    expect(await screen.findByText("0 total")).toBeInTheDocument();
    expect(screen.getByText("No resumes uploaded.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Asuka" })).toBeNull();
}

function reloadCurrentPage(): void {
    const currentPath = window.location.pathname;
    cleanup();
    window.history.replaceState(null, "", currentPath);
    renderApp(currentPath);
}

type BackendState = {
    mode: "auto" | "pending";
};

async function resetBackend(
    options: {
        mode?: BackendState["mode"];
        seedResume?: boolean;
        seedResumeCount?: number;
    } = {},
): Promise<void> {
    const params = new URLSearchParams({
        mode: options.mode ?? "auto",
        seedResume: String(options.seedResume ?? false),
        seedResumeCount: String(options.seedResumeCount ?? 0),
    });
    const response = await fetch(`/__test/reset?${params}`, {
        method: "POST",
    });

    expect(response.ok).toBe(true);
}
