import useSWR from "swr";
import type { ApiClient } from "../apiClient";
import { AppLink } from "../routing/AppLink";
import { resumeWriterSlug } from "../../shared/types";

type ResumesPageProps = {
    apiClient: ApiClient;
};

export function ResumesPage({ apiClient }: ResumesPageProps) {
    const { data, isLoading } = useSWR("resumes.table", () =>
        apiClient.listResumes(),
    );

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
                        </tr>
                    </thead>
                    <tbody>
                        {data.resumes.map((resume) => (
                            <tr key={resume.name}>
                                <td>
                                    <AppLink
                                        className="link link-info"
                                        to={`/info/${resumeWriterSlug(resume.name)}`}
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
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
