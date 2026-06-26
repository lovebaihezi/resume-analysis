import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ApiClient } from "../apiClient";

type JdPageProps = {
    apiClient: ApiClient;
};

export function JdPage({ apiClient }: JdPageProps) {
    const [rawText, setRawText] = useState("");
    const [error, setError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeId, setActiveId] = useState<string>();
    const { mutate } = useSWRConfig();
    const { data } = useSWR("jds.list", () => apiClient.listJds(), {
        fallbackData: {
            count: 0,
            jds: [],
        },
    });
    const active = data?.jds.find((jd) => jd.id === activeId) ?? data?.jds[0];

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(undefined);
        setIsSubmitting(true);

        try {
            const result = await apiClient.analyzeJd(rawText);
            setActiveId(result.jd.id);
            await mutate("jds.list");
        } catch (submitError) {
            setError(
                submitError instanceof Error
                    ? submitError.message
                    : "Failed to analyze JD",
            );
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <section className="grid gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_420px]">
            <form className="space-y-4" onSubmit={onSubmit}>
                <div>
                    <label className="label" htmlFor="jd-raw-text">
                        Job Description
                    </label>
                    <textarea
                        className="textarea textarea-bordered min-h-96 w-full"
                        id="jd-raw-text"
                        onChange={(event) => setRawText(event.target.value)}
                        placeholder="Paste raw JD text"
                        value={rawText}
                    />
                </div>
                <button
                    className="btn btn-primary"
                    disabled={isSubmitting || !rawText.trim()}
                    type="submit"
                >
                    Analyze JD
                </button>
                {error ? (
                    <div className="alert alert-error">
                        <span>{error}</span>
                    </div>
                ) : null}
            </form>
            <aside className="space-y-4">
                <div>
                    <h1 className="text-xl font-semibold">Structured JD</h1>
                    <p className="text-sm text-base-content/70">
                        {data?.count ?? 0} saved descriptions
                    </p>
                </div>
                {active ? (
                    <div className="rounded border border-base-300 bg-base-100 p-5">
                        <h2 className="text-lg font-semibold">
                            {active.title}
                        </h2>
                        <p className="mt-2 text-sm leading-6">{active.des}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {active.tags.map((tag) => (
                                <span className="badge badge-info" key={tag}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <div className="mt-5">
                            <h3 className="font-medium">Required Skills</h3>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                {active.requiredSkills.map((skill) => (
                                    <li key={skill}>{skill}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="mt-5">
                            <h3 className="font-medium">
                                Required Experiences
                            </h3>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                {active.requiredExperiences.map(
                                    (experience) => (
                                        <li key={experience}>{experience}</li>
                                    ),
                                )}
                            </ul>
                        </div>
                    </div>
                ) : (
                    <div className="rounded border border-base-300 bg-base-100 p-5 text-sm text-base-content/70">
                        No JD analyzed yet.
                    </div>
                )}
            </aside>
        </section>
    );
}
