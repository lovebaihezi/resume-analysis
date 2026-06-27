import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ApiClient } from "../apiClient";
import type {
    JdMatchResult,
    JobDescription,
    ResumeJdMatch,
} from "../../shared/types";

type JdPageProps = {
    apiClient: ApiClient;
};

export function JdPage({ apiClient }: JdPageProps) {
    const [rawText, setRawText] = useState("");
    const [error, setError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeId, setActiveId] = useState<string>();
    const [selectedResumeId, setSelectedResumeId] = useState("");
    const [matchError, setMatchError] = useState<string>();
    const [isMatching, setIsMatching] = useState(false);
    const [matchProgress, setMatchProgress] = useState(0);
    const [matchResult, setMatchResult] = useState<JdMatchResult>();
    const { mutate } = useSWRConfig();
    const { data } = useSWR("jds.list", () => apiClient.listJds(), {
        fallbackData: {
            count: 0,
            jds: [],
        },
    });
    const { data: resumesData } = useSWR(
        "jds.resume-selector",
        () => apiClient.listResumes(),
        {
            fallbackData: {
                count: 0,
                resumes: [],
            },
        },
    );
    const selectedId = activeId ?? data?.jds[0]?.id;
    const { data: activeData } = useSWR(
        selectedId ? ["jds.detail", selectedId] : null,
        ([, id]) => apiClient.getJdInfo(id),
    );
    const active = activeData?.jd;
    const canMatch = Boolean(rawText.trim() && selectedResumeId);

    useEffect(() => {
        if (!isMatching) {
            return;
        }

        const interval = window.setInterval(() => {
            setMatchProgress((progress) => Math.min(progress + 8, 88));
        }, 160);

        return () => window.clearInterval(interval);
    }, [isMatching]);

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(undefined);
        setIsSubmitting(true);

        try {
            const result = await apiClient.analyzeJd(rawText);
            setActiveId(result.jd.id);
            await mutate(
                ["jds.detail", result.jd.id],
                { jd: result.jd },
                { revalidate: false },
            );
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

    async function onMatch(): Promise<void> {
        if (!canMatch) {
            return;
        }

        setMatchError(undefined);
        setMatchResult(undefined);
        setMatchProgress(12);
        setIsMatching(true);

        try {
            const [result] = await Promise.all([
                apiClient.matchJdResume(rawText, selectedResumeId),
                waitForVisibleProgress(),
            ]);

            setMatchProgress(100);
            setMatchResult(result);
            setActiveId(result.jd.id);
            await mutate(
                ["jds.detail", result.jd.id],
                { jd: result.jd },
                { revalidate: false },
            );
            await mutate("jds.list");
        } catch (matchSubmitError) {
            setMatchError(
                matchSubmitError instanceof Error
                    ? matchSubmitError.message
                    : "Failed to match resume",
            );
        } finally {
            setIsMatching(false);
        }
    }

    return (
        <section className="px-3 py-5 sm:px-6 lg:px-10 lg:py-8">
            <article className="mx-auto max-w-5xl overflow-hidden rounded border border-base-300 bg-base-100">
                <form
                    aria-labelledby="jd-input-title"
                    className="p-4 sm:p-6 lg:p-8"
                    onSubmit={onSubmit}
                >
                    <div className="mb-5">
                        <h1
                            className="text-xl font-semibold"
                            id="jd-input-title"
                        >
                            JD Input
                        </h1>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="label" htmlFor="jd-raw-text">
                                Job Description
                            </label>
                            <textarea
                                className="textarea textarea-bordered min-h-72 w-full text-sm leading-6 sm:min-h-80 lg:min-h-96"
                                id="jd-raw-text"
                                onChange={(event) =>
                                    setRawText(event.target.value)
                                }
                                placeholder="Paste raw JD text"
                                value={rawText}
                            />
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                            <div>
                                <label
                                    className="label"
                                    htmlFor="resume-selector"
                                >
                                    Uploaded Document
                                </label>
                                <select
                                    className="select select-bordered w-full"
                                    id="resume-selector"
                                    onChange={(event) =>
                                        setSelectedResumeId(event.target.value)
                                    }
                                    value={selectedResumeId}
                                >
                                    <option value="">Select a resume</option>
                                    {resumesData?.resumes.map((resume) => (
                                        <option
                                            key={resume.resumeId}
                                            value={resume.resumeId}
                                        >
                                            {resume.name}
                                        </option>
                                    ))}
                                </select>
                                {resumesData?.count === 0 ? (
                                    <p className="mt-2 text-sm text-base-content/60">
                                        Upload a resume before running a match.
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                                <button
                                    className="btn btn-outline w-full sm:w-auto"
                                    disabled={isSubmitting || !rawText.trim()}
                                    type="submit"
                                >
                                    {isSubmitting ? (
                                        <span className="loading loading-spinner loading-sm" />
                                    ) : null}
                                    Analyze JD
                                </button>
                                {canMatch ? (
                                    <button
                                        className="btn btn-primary w-full sm:w-auto"
                                        disabled={isMatching}
                                        onClick={() => {
                                            void onMatch();
                                        }}
                                        type="button"
                                    >
                                        {isMatching ? (
                                            <span className="loading loading-spinner loading-sm" />
                                        ) : null}
                                        Match Resume
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {isMatching ? (
                            <div className="rounded border border-info/30 bg-info/10 p-4">
                                <div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium">
                                    <span>Analyzing resume match</span>
                                    <span>{matchProgress}%</span>
                                </div>
                                <progress
                                    aria-label="Match analysis progress"
                                    className="progress progress-info w-full"
                                    max={100}
                                    value={matchProgress}
                                />
                            </div>
                        ) : null}

                        {error ? (
                            <div className="alert alert-error">
                                <span>{error}</span>
                            </div>
                        ) : null}
                        {matchError ? (
                            <div className="alert alert-error">
                                <span>{matchError}</span>
                            </div>
                        ) : null}
                    </div>
                </form>

                <JdAnalysisPanel active={active} count={data?.count ?? 0} />

                {matchResult ? (
                    <MatchResultPanel result={matchResult} />
                ) : (
                    <section
                        aria-labelledby="match-result-title"
                        className="border-t border-base-300 p-4 sm:p-6 lg:p-8"
                    >
                        <h2
                            className="text-xl font-semibold"
                            id="match-result-title"
                        >
                            Match Result
                        </h2>
                        <p className="mt-3 text-sm text-base-content/70">
                            No match result yet.
                        </p>
                    </section>
                )}
            </article>
        </section>
    );
}

function JdAnalysisPanel({
    active,
    count,
}: {
    active?: JobDescription;
    count: number;
}) {
    return (
        <section
            aria-labelledby="jd-analysis-title"
            className="border-t border-base-300 p-4 sm:p-6 lg:p-8"
        >
            <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <h2 className="text-xl font-semibold" id="jd-analysis-title">
                    JD Analysis Result
                </h2>
                <p className="text-sm text-base-content/70">
                    {count} saved descriptions
                </p>
            </div>
            {active ? (
                <div className="space-y-5">
                    <div>
                        <h3 className="text-lg font-semibold">
                            {active.title}
                        </h3>
                        <p className="mt-2 text-sm leading-6">{active.des}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {active.tags.map((tag) => (
                                <span className="badge badge-info" key={tag}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                        <div>
                            <h4 className="font-medium">Required Skills</h4>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                {active.requiredSkills.map((skill) => (
                                    <li key={skill}>{skill}</li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-medium">
                                Required Experiences
                            </h4>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                {active.requiredExperiences.map(
                                    (experience) => (
                                        <li key={experience}>{experience}</li>
                                    ),
                                )}
                            </ul>
                        </div>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-base-content/70">
                    No JD analyzed yet.
                </p>
            )}
        </section>
    );
}

function MatchResultPanel({ result }: { result: JdMatchResult }) {
    return (
        <section
            aria-labelledby="match-result-title"
            className="border-t border-base-300 p-4 sm:p-6 lg:p-8"
        >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2
                        className="text-xl font-semibold"
                        id="match-result-title"
                    >
                        AI Match Result
                    </h2>
                    <p className="text-sm text-base-content/70">
                        {result.match.resumeName} for {result.jd.title}
                    </p>
                </div>
                <div className="badge badge-primary p-4">
                    {overallPercentage(result.match)}% overall
                </div>
            </div>
            <p className="mb-5 text-sm leading-6">
                <span className="font-medium">Advantages:</span>{" "}
                {result.match.intro.advantages}{" "}
                <span className="font-medium">Disadvantages:</span>{" "}
                {result.match.intro.disadvantages}
            </p>
            <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                <ResumeRadarChart dimensions={result.match.dimensions} />
                <MobileMatchDimensions dimensions={result.match.dimensions} />
                <div className="hidden overflow-x-auto md:block">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Dimension</th>
                                <th>Score</th>
                                <th>Match</th>
                                <th>Rationale</th>
                            </tr>
                        </thead>
                        <tbody>
                            {result.match.dimensions.map((dimension) => (
                                <tr key={dimension.dimension}>
                                    <td>{dimension.label}</td>
                                    <td>{dimension.score.toFixed(1)} / 5</td>
                                    <td>{dimension.percentage}%</td>
                                    <td>{dimension.rationale}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}

function MobileMatchDimensions({
    dimensions,
}: {
    dimensions: ResumeJdMatch["dimensions"];
}) {
    return (
        <div className="space-y-4 md:hidden">
            {dimensions.map((dimension) => (
                <section
                    aria-label={`${dimension.label} match detail`}
                    className="border-t border-base-300 pt-4 first:border-t-0 first:pt-0"
                    key={dimension.dimension}
                >
                    <div className="flex items-start justify-between gap-4">
                        <h3 className="font-medium">{dimension.label}</h3>
                        <span className="badge badge-outline">
                            {dimension.percentage}%
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-base-content/70">
                        Score {dimension.score.toFixed(1)} of 5
                    </p>
                    <p className="mt-2 text-sm leading-6">
                        {dimension.rationale}
                    </p>
                </section>
            ))}
        </div>
    );
}

function ResumeRadarChart({
    dimensions,
}: {
    dimensions: ResumeJdMatch["dimensions"];
}) {
    const size = 360;
    const center = size / 2;
    const radius = 104;
    const maxScore = 5;
    const axes = dimensions.map((dimension, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / dimensions.length;

        return {
            angle,
            dimension,
            end: radarPoint(center, radius, angle),
            label: radarPoint(center, radius + 38, angle),
            value: radarPoint(
                center,
                (radius * dimension.score) / maxScore,
                angle,
            ),
        };
    });
    const polygonPoints = axes
        .map((axis) => `${axis.value.x},${axis.value.y}`)
        .join(" ");

    return (
        <svg
            aria-label="Resume match radar chart"
            className="mx-auto h-auto w-full max-w-[360px]"
            viewBox={`0 0 ${size} ${size}`}
        >
            {[1, 2, 3, 4, 5].map((level) => {
                const levelRadius = (radius * level) / maxScore;
                const points = axes
                    .map((axis) => radarPoint(center, levelRadius, axis.angle))
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ");

                return (
                    <polygon
                        className="fill-none stroke-base-300"
                        key={level}
                        points={points}
                        strokeWidth="1"
                    />
                );
            })}
            {axes.map((axis) => (
                <line
                    className="stroke-base-300"
                    key={axis.dimension.dimension}
                    strokeWidth="1"
                    x1={center}
                    x2={axis.end.x}
                    y1={center}
                    y2={axis.end.y}
                />
            ))}
            <polygon
                className="fill-primary/25 stroke-primary"
                points={polygonPoints}
                strokeLinejoin="round"
                strokeWidth="3"
            />
            {axes.map((axis) => (
                <g key={`${axis.dimension.dimension}-label`}>
                    <circle
                        className="fill-primary"
                        cx={axis.value.x}
                        cy={axis.value.y}
                        r="4"
                    />
                    <text
                        className="fill-base-content text-[12px] font-medium"
                        dominantBaseline="middle"
                        textAnchor={textAnchorFor(axis.angle)}
                        x={axis.label.x}
                        y={axis.label.y}
                    >
                        {axis.dimension.label}
                    </text>
                </g>
            ))}
        </svg>
    );
}

function radarPoint(center: number, radius: number, angle: number) {
    return {
        x: center + Math.cos(angle) * radius,
        y: center + Math.sin(angle) * radius,
    };
}

function textAnchorFor(angle: number): "end" | "middle" | "start" {
    const x = Math.cos(angle);

    if (x > 0.25) {
        return "start";
    }

    if (x < -0.25) {
        return "end";
    }

    return "middle";
}

function overallPercentage(match: ResumeJdMatch): number {
    return (
        match.dimensions.find((dimension) => dimension.dimension === "overall")
            ?.percentage ?? 0
    );
}

function waitForVisibleProgress(): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, 900);
    });
}
