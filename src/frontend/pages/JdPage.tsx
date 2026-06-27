import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ApiClient } from "../apiClient";
import type {
    JdMatchResult,
    JobDescription,
    JobDescriptionSummary,
    ResumeJdMatch,
    ResumeSummary,
} from "../../shared/types";

type JdPageProps = {
    apiClient: ApiClient;
};

const JD_TABLE_COLUMNS =
    "minmax(14rem,1fr) minmax(16rem,1.2fr) minmax(10rem,0.65fr) minmax(7rem,auto)";

export function JdPage({ apiClient }: JdPageProps) {
    const [newJdText, setNewJdText] = useState("");
    const [error, setError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [selectedJdId, setSelectedJdId] = useState("");
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
    const savedJds = data?.jds ?? [];
    const resumes = resumesData?.resumes ?? [];
    const selectedJdIdForDetail = selectedJdId || savedJds[0]?.id || "";
    const { data: selectedJdData } = useSWR(
        selectedJdIdForDetail ? ["jds.detail", selectedJdIdForDetail] : null,
        ([, id]) => apiClient.getJdInfo(id),
    );
    const selectedJd = selectedJdData?.jd;
    const selectedResume =
        resumes.find((resume) => resume.resumeId === selectedResumeId) ?? null;
    const canAddJd = Boolean(newJdText.trim());
    const canMatch = Boolean(selectedJd?.rawText.trim() && selectedResumeId);

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
            const result = await apiClient.analyzeJd(newJdText);
            setSelectedJdId(result.jd.id);
            setDrawerOpen(false);
            setNewJdText("");
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
        if (!canMatch || !selectedJd) {
            return;
        }

        setMatchError(undefined);
        setMatchResult(undefined);
        setMatchProgress(12);
        setIsMatching(true);

        try {
            const [result] = await Promise.all([
                apiClient.matchJdResume(selectedJd.rawText, selectedResumeId),
                waitForVisibleProgress(),
            ]);

            setMatchProgress(100);
            setMatchResult(result);
            setSelectedJdId(result.jd.id);
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
        <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col px-4 py-4 sm:px-8 sm:py-8">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">JD Editor</h1>
                    <p className="text-base-content/70">
                        {data?.count ?? 0} saved descriptions
                    </p>
                </div>
                <button
                    className="btn btn-primary w-full sm:w-auto"
                    onClick={() => {
                        setError(undefined);
                        setDrawerOpen(true);
                    }}
                    type="button"
                >
                    <PlusIcon aria-hidden="true" className="h-4 w-4" />
                    Add JD
                </button>
            </div>

            <SavedJdTable
                jds={savedJds}
                onSelect={setSelectedJdId}
                selectedJdId={selectedJdIdForDetail}
            />

            <section
                aria-labelledby="match-builder-title"
                className="mt-8 space-y-5"
            >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2
                            className="text-xl font-semibold"
                            id="match-builder-title"
                        >
                            Match JD and Resume
                        </h2>
                    </div>
                    <div className="grid w-full gap-3 lg:max-w-3xl lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                        <label className="form-control">
                            <span className="label">
                                <span className="label-text">
                                    Job Description
                                </span>
                            </span>
                            <select
                                className="select select-bordered w-full"
                                disabled={savedJds.length === 0}
                                onChange={(event) => {
                                    setSelectedJdId(event.target.value);
                                }}
                                value={selectedJdIdForDetail}
                            >
                                <option value="">Select a JD</option>
                                {savedJds.map((jd) => (
                                    <option key={jd.id} value={jd.id}>
                                        {jd.title}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="form-control">
                            <span className="label">
                                <span className="label-text">Resume</span>
                            </span>
                            <select
                                className="select select-bordered w-full"
                                disabled={resumes.length === 0}
                                onChange={(event) => {
                                    setSelectedResumeId(event.target.value);
                                }}
                                value={selectedResumeId}
                            >
                                <option value="">Select a resume</option>
                                {resumes.map((resume) => (
                                    <option
                                        key={resume.resumeId}
                                        value={resume.resumeId}
                                    >
                                        {resume.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            className="btn btn-primary w-full lg:w-auto"
                            disabled={!canMatch || isMatching}
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
                    </div>
                </div>

                {resumesData?.count === 0 ? (
                    <p className="text-sm text-base-content/60">
                        Upload a resume before running a match.
                    </p>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                    <JdPreviewPanel jd={selectedJd} />
                    <ResumePreviewPanel resume={selectedResume} />
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

                {matchError ? (
                    <div className="alert alert-error">
                        <span>{matchError}</span>
                    </div>
                ) : null}
            </section>

            {matchResult ? (
                <MatchResultPanel result={matchResult} />
            ) : (
                <section aria-labelledby="match-result-title" className="mt-8">
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

            <AddJdDrawer
                error={error}
                isOpen={drawerOpen}
                isSubmitting={isSubmitting}
                newJdText={newJdText}
                onClose={() => {
                    setDrawerOpen(false);
                }}
                onSubmit={onSubmit}
                onTextChange={setNewJdText}
                submitDisabled={isSubmitting || !canAddJd}
            />
        </section>
    );
}

function SavedJdTable({
    jds,
    onSelect,
    selectedJdId,
}: {
    jds: JobDescriptionSummary[];
    onSelect: (jdId: string) => void;
    selectedJdId: string;
}) {
    return (
        <div className="overflow-x-auto rounded border border-base-300 bg-base-100">
            <table
                aria-label="Saved job descriptions"
                className="w-full min-w-[760px] table-fixed"
            >
                <thead className="border-b border-base-300 bg-base-200/70">
                    <tr
                        className="grid w-full items-center text-left text-sm font-semibold text-base-content/70"
                        style={{ gridTemplateColumns: JD_TABLE_COLUMNS }}
                    >
                        <th className="px-4 py-3 text-left font-semibold">
                            JD Title
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                            Tags
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                            Updated
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                            Status
                        </th>
                    </tr>
                </thead>
                <tbody className="block w-full">
                    {jds.length === 0 ? (
                        <tr
                            className="grid min-h-20 w-full items-center"
                            style={{ gridTemplateColumns: JD_TABLE_COLUMNS }}
                        >
                            <td
                                className="px-4 py-5 text-base-content/60"
                                colSpan={4}
                                style={{ gridColumn: "1 / -1" }}
                            >
                                No saved JDs.
                            </td>
                        </tr>
                    ) : (
                        jds.map((jd) => (
                            <SavedJdRow
                                jd={jd}
                                key={jd.id}
                                onSelect={onSelect}
                                selected={jd.id === selectedJdId}
                            />
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function SavedJdRow({
    jd,
    onSelect,
    selected,
}: {
    jd: JobDescriptionSummary;
    onSelect: (jdId: string) => void;
    selected: boolean;
}) {
    const visibleTags = jd.tags.slice(0, 4);
    const hiddenTagCount = Math.max(0, jd.tags.length - visibleTags.length);

    return (
        <tr
            className="grid min-h-20 w-full items-center border-t border-base-300 text-sm first:border-t-0"
            style={{ gridTemplateColumns: JD_TABLE_COLUMNS }}
        >
            <td className="min-w-0 px-4">
                <button
                    className="link link-info block max-w-full truncate text-left"
                    onClick={() => onSelect(jd.id)}
                    type="button"
                >
                    {jd.title}
                </button>
            </td>
            <td className="min-w-0 px-4">
                <div className="flex max-h-12 flex-wrap gap-2 overflow-hidden">
                    {visibleTags.map((tag) => (
                        <span className="badge badge-outline" key={tag}>
                            {tag}
                        </span>
                    ))}
                    {hiddenTagCount > 0 ? (
                        <span className="badge badge-ghost">
                            +{hiddenTagCount}
                        </span>
                    ) : null}
                </div>
            </td>
            <td className="truncate px-4 text-base-content/70">
                {formatDateTime(jd.updatedAt)}
            </td>
            <td className="px-4">
                {selected ? (
                    <span className="badge badge-primary">Selected</span>
                ) : (
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => onSelect(jd.id)}
                        type="button"
                    >
                        Select
                    </button>
                )}
            </td>
        </tr>
    );
}

function AddJdDrawer({
    error,
    isOpen,
    isSubmitting,
    newJdText,
    onClose,
    onSubmit,
    onTextChange,
    submitDisabled,
}: {
    error?: string;
    isOpen: boolean;
    isSubmitting: boolean;
    newJdText: string;
    onClose: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    onTextChange: (value: string) => void;
    submitDisabled: boolean;
}) {
    if (!isOpen) {
        return null;
    }

    return (
        <div aria-label="Add JD drawer" className="fixed inset-0 z-50">
            <button
                aria-label="Close JD drawer"
                className="absolute inset-0 h-full w-full bg-black/35"
                onClick={onClose}
                type="button"
            />
            <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-2xl flex-col overflow-y-auto bg-base-100 p-4 shadow-2xl sm:p-8">
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-semibold">Add JD</h2>
                    </div>
                    <button
                        aria-label="Close JD drawer"
                        className="btn btn-ghost btn-square btn-sm"
                        onClick={onClose}
                        type="button"
                    >
                        <XIcon aria-hidden="true" className="h-4 w-4" />
                    </button>
                </div>
                <form
                    aria-labelledby="jd-input-title"
                    className="flex min-h-0 flex-1 flex-col gap-4"
                    onSubmit={onSubmit}
                >
                    <h3 className="sr-only" id="jd-input-title">
                        New JD input
                    </h3>
                    <div className="form-control min-h-0 flex-1">
                        <label className="label" htmlFor="new-jd-text">
                            <span className="label-text">Paste JD Text</span>
                        </label>
                        <textarea
                            className="textarea textarea-bordered min-h-72 flex-1 resize-none text-sm leading-6 sm:min-h-96"
                            id="new-jd-text"
                            onChange={(event) =>
                                onTextChange(event.target.value)
                            }
                            placeholder="Paste raw JD text"
                            value={newJdText}
                        />
                    </div>
                    {error ? (
                        <div className="alert alert-error">
                            <span>{error}</span>
                        </div>
                    ) : null}
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                            className="btn btn-ghost w-full sm:w-auto"
                            onClick={onClose}
                            type="button"
                        >
                            Cancel
                        </button>
                        <button
                            className="btn btn-primary w-full sm:w-auto"
                            disabled={submitDisabled}
                            type="submit"
                        >
                            {isSubmitting ? (
                                <span className="loading loading-spinner loading-sm" />
                            ) : null}
                            Analyze JD
                        </button>
                    </div>
                </form>
            </aside>
        </div>
    );
}

function JdPreviewPanel({ jd }: { jd?: JobDescription }) {
    return (
        <section
            aria-labelledby="selected-jd-title"
            className="rounded border border-base-300 bg-base-100 p-4"
        >
            <h3 className="text-lg font-semibold" id="selected-jd-title">
                Selected JD
            </h3>
            {jd ? (
                <div className="mt-4 space-y-5">
                    <div>
                        <h4 className="font-semibold">{jd.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-base-content/80">
                            {jd.des}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {jd.tags.map((tag) => (
                                <span className="badge badge-info" key={tag}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2">
                        <RequirementList
                            items={jd.requiredSkills}
                            title="Required Skills"
                        />
                        <RequirementList
                            items={jd.requiredExperiences}
                            title="Required Experiences"
                        />
                    </div>
                </div>
            ) : (
                <p className="mt-3 text-sm text-base-content/70">
                    Select a saved JD to preview it.
                </p>
            )}
        </section>
    );
}

function ResumePreviewPanel({ resume }: { resume: ResumeSummary | null }) {
    return (
        <section
            aria-labelledby="selected-resume-title"
            className="rounded border border-base-300 bg-base-100 p-4"
        >
            <h3 className="text-lg font-semibold" id="selected-resume-title">
                Selected Resume
            </h3>
            {resume ? (
                <div className="mt-4 space-y-4">
                    <div>
                        <h4 className="font-semibold">{resume.name}</h4>
                        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                                <dt className="text-base-content/60">
                                    Work Duration
                                </dt>
                                <dd className="font-medium">
                                    {resume.workDuration}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-base-content/60">
                                    Highest Education
                                </dt>
                                <dd className="font-medium">
                                    {resume.highestEducation}
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <div>
                        <h4 className="font-medium">Skills</h4>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {resume.skills.map((skill) => (
                                <span
                                    className="badge badge-outline"
                                    key={skill}
                                >
                                    {skill}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <p className="mt-3 text-sm text-base-content/70">
                    Select a resume to preview it.
                </p>
            )}
        </section>
    );
}

function RequirementList({ items, title }: { items: string[]; title: string }) {
    return (
        <div>
            <h4 className="font-medium">{title}</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {items.map((item) => (
                    <li key={item}>{item}</li>
                ))}
            </ul>
        </div>
    );
}

function MatchResultPanel({ result }: { result: JdMatchResult }) {
    return (
        <section aria-labelledby="match-result-title" className="mt-8">
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

function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}
