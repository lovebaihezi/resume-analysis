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
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/frontend/App";
import type { ApiClient, UploadSource } from "../../src/frontend/apiClient";
import { sampleJobDescription, sampleResume } from "../fixtures/sampleData";

function createBrowserApi(): ApiClient & {
    sources: UploadSource[];
} {
    const sources: UploadSource[] = [];

    return {
        sources,
        async uploadResume(file, source, onProgress) {
            sources.push(source);
            onProgress({ loaded: file.size, total: file.size, percent: 100 });

            return {
                resume: sampleResume,
                upload: {
                    bytes: file.size,
                    percent: 100,
                    source,
                },
            };
        },
        async listResumes() {
            return {
                count: 1,
                resumes: [
                    {
                        name: "Ava Chen",
                        workDuration: "2020-01-01 to 2024-03-01",
                        highestEducation: "Master",
                        skills: ["React", "Cloudflare Workers", "XState"],
                    },
                ],
            };
        },
        async getResumeInfo() {
            return { resume: sampleResume };
        },
        async analyzeJd() {
            return { jd: sampleJobDescription };
        },
        async listJds() {
            return { count: 1, jds: [sampleJobDescription] };
        },
    };
}

describe("resume analysis UI behavior", () => {
    afterEach(() => {
        cleanup();
        window.history.replaceState(null, "", "/");
    });

    it("renders the responsive DaisyUI navbar and XState-owned links", async () => {
        const api = createBrowserApi();
        render(<App apiClient={api} initialEntries={["/"]} />);

        const nav = screen.getByRole("navigation", { name: /primary/i });
        expect(within(nav).getByText("Resume")).toBeInTheDocument();
        const resumeLinks =
            await within(nav).findAllByText(/uploaded resumes/i);
        const firstResumeLink = resumeLinks[0];
        const firstJdLink = within(nav).getAllByText(/jd editor/i)[0];

        expect(firstResumeLink).toBeDefined();
        expect(firstJdLink).toBeDefined();
        expect(firstResumeLink?.closest("a")).toHaveAttribute(
            "href",
            "/resumes",
        );
        expect(firstJdLink?.closest("a")).toHaveAttribute("href", "/jd");
    });

    it("uploads a PDF from click selection, shows progress, and routes to the info page", async () => {
        const user = userEvent.setup();
        const api = createBrowserApi();
        render(<App apiClient={api} initialEntries={["/"]} />);
        const file = new File(["%PDF-1.7\nAva"], "ava-chen.pdf", {
            type: "application/pdf",
        });

        await user.upload(screen.getByLabelText(/choose resume pdf/i), file);

        expect(api.sources).toEqual(["click"]);
        expect(await screen.findByText(/100%/)).toBeInTheDocument();
        await waitFor(() => {
            expect(window.location.pathname).toBe("/info/Ava%20Chen");
        });
        expect(await screen.findByText(/raw resume/i)).toBeInTheDocument();
        expect(
            screen.getByText("Ava Chen", { selector: "p" }),
        ).toBeInTheDocument();
    });

    it("tracks drag and paste upload sources separately", async () => {
        const api = createBrowserApi();
        render(<App apiClient={api} initialEntries={["/"]} />);
        const file = new File(["%PDF-1.7\nAva"], "ava-chen.pdf", {
            type: "application/pdf",
        });
        const zone = screen.getByTestId("resume-dropzone");

        await act(async () => {
            fireEvent(zone, dropEvent(file));
        });

        await waitFor(() => {
            expect(api.sources).toContain("drag");
        });

        cleanup();
        window.history.replaceState(null, "", "/");
        render(<App apiClient={api} initialEntries={["/"]} />);

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
            expect(api.sources).toContain("drag");
            expect(api.sources).toContain("paste");
        });
    });

    it("rejects non-PDF files in the upload surface before calling the API", async () => {
        const api = createBrowserApi();
        render(<App apiClient={api} initialEntries={["/"]} />);
        const file = new File(["hello"], "resume.txt", { type: "text/plain" });
        const zone = screen.getByTestId("resume-dropzone");

        await act(async () => {
            fireEvent(zone, dropEvent(file));
        });

        expect(await screen.findByText(/pdf files only/i)).toBeInTheDocument();
        expect(api.sources).toEqual([]);
    });

    it("submits a raw JD and displays structured AI output", async () => {
        const user = userEvent.setup();
        const api = createBrowserApi();
        render(<App apiClient={api} initialEntries={["/jd"]} />);

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
