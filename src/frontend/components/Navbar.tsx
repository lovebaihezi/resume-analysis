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
                <AppLink className="btn btn-ghost justify-start" to="/resumes">
                    Uploaded Resumes {count}
                </AppLink>
            </li>
            <li>
                <AppLink className="btn btn-ghost justify-start" to="/jd">
                    JD Editor
                </AppLink>
            </li>
        </>
    );

    return (
        <nav
            aria-label="Primary"
            className="navbar border-b border-base-300 bg-base-100 px-4"
        >
            <div className="navbar-start">
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
                <AppLink
                    className="btn btn-ghost font-serif text-2xl italic"
                    to="/"
                >
                    Resume
                </AppLink>
            </div>
            <div className="navbar-center hidden lg:flex">
                <ul className="menu menu-horizontal gap-2 px-1">{menu}</ul>
            </div>
            <div className="navbar-end" />
        </nav>
    );
}
