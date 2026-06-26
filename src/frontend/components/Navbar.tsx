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
    const menu = (
        <>
            <li>
                <AppLink
                    className="btn btn-ghost justify-start gap-2"
                    to="/resumes"
                >
                    <InboxIcon />
                    <span>Uploaded Resumes</span>
                    <span className="badge badge-info badge-sm tabular-nums">
                        {count}
                    </span>
                </AppLink>
            </li>
            <li>
                <AppLink className="btn btn-ghost justify-start gap-2" to="/jd">
                    <DocumentIcon />
                    <span>JD Editor</span>
                </AppLink>
            </li>
        </>
    );

    return (
        <nav
            aria-label="Primary"
            className="navbar border-b border-base-300 bg-base-100 px-4"
        >
            <div className="navbar-start flex-1 gap-2">
                <div className="dropdown lg:hidden">
                    <button
                        aria-label="Open menu"
                        className="btn btn-ghost btn-square"
                        tabIndex={0}
                        type="button"
                    >
                        <span className="text-xl">☰</span>
                    </button>
                    <ul className="menu dropdown-content z-10 mt-3 w-60 rounded-box bg-base-100 p-2 shadow">
                        {menu}
                    </ul>
                </div>
                <ul className="menu menu-horizontal hidden gap-2 px-0 lg:flex">
                    {menu}
                </ul>
                <AppLink
                    className="btn btn-ghost h-auto min-h-12 flex-col items-start gap-0 px-3 py-2 font-serif text-xl italic leading-none"
                    to="/"
                >
                    <span>Resume</span>
                    <span>Analysis</span>
                </AppLink>
            </div>
            <div className="navbar-end" />
        </nav>
    );
}

function InboxIcon() {
    return (
        <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
        >
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        </svg>
    );
}

function DocumentIcon() {
    return (
        <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8" />
            <path d="M8 17h5" />
        </svg>
    );
}
