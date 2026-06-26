import { useState } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import type { ApiClient } from "../apiClient";
import { AppLink } from "../routing/AppLink";

type ResumesPageProps = {
    apiClient: ApiClient;
};

export function ResumesPage({ apiClient }: ResumesPageProps) {
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const [archivingResumeId, setArchivingResumeId] = useState<string | null>(
        null,
    );
    const { data, isLoading, mutate } = useSWR("resumes.table", () =>
        apiClient.listResumes(),
    );

    async function archiveResume(resumeId: string): Promise<void> {
        setArchiveError(null);
        setArchivingResumeId(resumeId);

        try {
            await apiClient.archiveResume(resumeId);
            await Promise.all([mutate(), mutateGlobal("resumes.nav-count")]);
        } catch (error) {
            setArchiveError(
                error instanceof Error
                    ? error.message
                    : "Failed to archive resume",
            );
        } finally {
            setArchivingResumeId(null);
        }
    }

    if (isLoading || !data) {
        return <div className="p-8">Loading resumes...</div>;
    }

    return (
        <section className="mx-auto max-w-6xl px-4 py-8">
            <div className="mb-5 flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Uploaded Resumes</h1>
                    <p className="text-base-content/70">{data.count} total</p>
                </div>
            </div>
            <div className="overflow-x-auto rounded border border-base-300 bg-base-100">
                <table className="table">
                    <thead>
                        <tr>
                            <th>Resume Name</th>
                            <th>Work Duration</th>
                            <th>Highest Edu Seat</th>
                            <th>Skills</th>
                            <th>
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.resumes.length === 0 ? (
                            <tr>
                                <td
                                    className="text-base-content/60"
                                    colSpan={5}
                                >
                                    No resumes uploaded.
                                </td>
                            </tr>
                        ) : null}
                        {data.resumes.map((resume) => (
                            <tr key={resume.resumeId}>
                                <td>
                                    <AppLink
                                        className="link link-info"
                                        to={`/resumes/${resume.resumeId}`}
                                    >
                                        {resume.name}
                                    </AppLink>
                                </td>
                                <td>{resume.workDuration}</td>
                                <td>{resume.highestEducation}</td>
                                <td>
                                    <div className="flex flex-wrap gap-2">
                                        {resume.skills.map((skill) => (
                                            <span
                                                className="badge badge-outline"
                                                key={skill}
                                            >
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                </td>
                                <td className="w-14 text-right">
                                    <button
                                        aria-label={`Archive ${resume.name}`}
                                        className="btn btn-ghost btn-square btn-sm text-error"
                                        disabled={
                                            archivingResumeId ===
                                            resume.resumeId
                                        }
                                        onClick={() => {
                                            void archiveResume(resume.resumeId);
                                        }}
                                        title="Archive"
                                        type="button"
                                    >
                                        {archivingResumeId ===
                                        resume.resumeId ? (
                                            <span className="loading loading-spinner loading-xs" />
                                        ) : (
                                            <SimpleIconsArchiveIcon />
                                        )}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {archiveError ? (
                <p className="mt-3 text-sm text-error">{archiveError}</p>
            ) : null}
        </section>
    );
}

function SimpleIconsArchiveIcon() {
    return (
        <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="currentColor"
            viewBox="0 0 24 24"
        >
            <path d="M22.667 22.884V24H1.333v-1.116zm-.842-1.675v1.396H2.175v-1.396zM4.233 6.14l.234.118.118 1.882.117 3.058v2.941l-.117 3.666-.02 2.47-.332.098H3.062l-.352-.098-.136-2.47-.118-3.646v-2.941l.118-3.078.107-1.892.244-.107zm16.842 0 .235.118.117 1.882.117 3.058v2.941l-.117 3.666-.02 2.47-.332.098h-1.171l-.352-.098-.137-2.47-.117-3.646v-2.941l.117-3.078.108-1.892.244-.107zm-11.79 0 .235.118.117 1.882.117 3.058v2.941l-.117 3.666-.02 2.47-.331.098H8.114l-.352-.098-.136-2.47-.117-3.646v-2.941l.117-3.078.107-1.892.244-.107zm6.457 0 .234.118.117 1.882.118 3.058v2.941l-.118 3.666-.019 2.47-.332.098H14.57l-.351-.098-.137-2.47-.117-3.646v-2.941l.117-3.078.108-1.892.244-.107zm6.083-2.511V5.58H2.175V3.628zM11.798 0l10.307 2.347-.413.723H1.951l-.618-.587Z" />
        </svg>
    );
}
