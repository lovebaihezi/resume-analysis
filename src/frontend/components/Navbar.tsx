import { FileTextIcon, NotePencilIcon } from "@phosphor-icons/react";
import useSWR from "swr";
import type { ApiClient } from "../apiClient";
import { AppLink } from "../routing/AppLink";

type NavbarProps = {
    apiClient: ApiClient;
};

export function Navbar({ apiClient }: NavbarProps) {
    const { data } = useSWR(
        "resumes.nav-count",
        () => apiClient.listResumes(),
        {
            fallbackData: {
                count: 0,
                resumes: [],
            },
        },
    );
    const count = data?.count ?? 0;
    const navLinks = (
        <>
            <AppLink
                aria-label="Uploaded Resumes"
                className="btn btn-ghost btn-square relative"
                to="/resumes"
            >
                <FileTextIcon aria-hidden="true" className="h-5 w-5" />
                <span className="badge badge-info badge-xs absolute right-1 top-1 tabular-nums">
                    {count}
                </span>
            </AppLink>
            <AppLink
                aria-label="JD Editor"
                className="btn btn-ghost btn-square"
                to="/jd"
            >
                <NotePencilIcon aria-hidden="true" className="h-5 w-5" />
            </AppLink>
        </>
    );

    return (
        <nav
            aria-label="Primary"
            className="navbar border-b border-base-300 bg-base-100 px-4"
        >
            <div className="navbar-start">
                <AppLink
                    className="btn btn-ghost h-auto min-h-12 flex-col items-start gap-0 px-3 py-2 font-serif text-xl italic leading-none"
                    to="/"
                >
                    <span>Resume</span>
                    <span>Analysis</span>
                </AppLink>
            </div>
            <div className="navbar-end gap-2">{navLinks}</div>
        </nav>
    );
}
