import { ArchiveIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import type { ApiClient } from "../apiClient";
import { AppLink } from "../routing/AppLink";
import type { ResumeSummary } from "../../shared/types";

type ResumesPageProps = {
    apiClient: ApiClient;
};

const RESUME_ROW_HEIGHT = 84;
const RESUME_LIST_MAX_HEIGHT = 560;
const RESUME_LIST_OVERSCAN = 6;
const RESUME_TABLE_COLUMNS =
    "minmax(14rem, 1.25fr) minmax(10rem, 0.85fr) minmax(10rem, 0.85fr) minmax(18rem, 1.45fr) 3.5rem";

export function ResumesPage({ apiClient }: ResumesPageProps) {
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const [archivingResumeId, setArchivingResumeId] = useState<string | null>(
        null,
    );
    const [searchQuery, setSearchQuery] = useState("");
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const virtualListRef = useRef<HTMLTableSectionElement | null>(null);
    const { data, isLoading, mutate } = useSWR("resumes.table", () =>
        apiClient.listResumes(),
    );
    const searchTokens = useMemo(
        () => tokenizeSearchQuery(searchQuery),
        [searchQuery],
    );
    const filteredResumes = useMemo(
        () => filterResumes(data?.resumes ?? [], searchTokens),
        [data?.resumes, searchTokens],
    );
    const visibleRange = useMemo(
        () =>
            getVirtualRange({
                itemCount: filteredResumes.length,
                itemHeight: RESUME_ROW_HEIGHT,
                overscan: RESUME_LIST_OVERSCAN,
                scrollTop,
                viewportHeight:
                    viewportHeight ||
                    Math.min(
                        filteredResumes.length * RESUME_ROW_HEIGHT,
                        RESUME_LIST_MAX_HEIGHT,
                    ),
            }),
        [filteredResumes.length, scrollTop, viewportHeight],
    );
    const visibleResumes = filteredResumes.slice(
        visibleRange.startIndex,
        visibleRange.endIndex,
    );
    const totalTableHeight = filteredResumes.length * RESUME_ROW_HEIGHT;
    const virtualListHeight =
        filteredResumes.length > 0
            ? Math.min(totalTableHeight, RESUME_LIST_MAX_HEIGHT)
            : undefined;
    const searchIsActive = searchTokens.length > 0;
    const resultCountText = searchIsActive
        ? `${filteredResumes.length} of ${data?.count ?? 0} shown`
        : `${data?.count ?? 0} total`;

    useEffect(() => {
        const element = virtualListRef.current;

        if (!element) {
            return;
        }

        function updateViewportHeight(): void {
            setViewportHeight(element?.clientHeight ?? 0);
        }

        updateViewportHeight();

        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", updateViewportHeight);

            return () => {
                window.removeEventListener("resize", updateViewportHeight);
            };
        }

        const resizeObserver = new ResizeObserver(updateViewportHeight);

        resizeObserver.observe(element);

        return () => {
            resizeObserver.disconnect();
        };
    }, [filteredResumes.length]);

    useEffect(() => {
        setScrollTop(0);
        virtualListRef.current?.scrollTo({ top: 0 });
    }, [searchQuery, data?.resumes]);

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
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Uploaded Resumes</h1>
                    <p className="text-base-content/70">{resultCountText}</p>
                </div>
                <label className="input input-bordered flex w-full items-center gap-2 sm:max-w-sm">
                    <MagnifyingGlassIcon
                        aria-hidden="true"
                        className="h-4 w-4 text-base-content/50"
                    />
                    <span className="sr-only">Search resumes</span>
                    <input
                        aria-label="Search resumes"
                        className="grow"
                        disabled={data.resumes.length === 0}
                        onChange={(event) => {
                            setSearchQuery(event.target.value);
                        }}
                        placeholder="Search resumes"
                        type="search"
                        value={searchQuery}
                    />
                </label>
            </div>
            <div className="overflow-x-auto rounded border border-base-300 bg-base-100">
                <table
                    aria-label="Uploaded resumes"
                    aria-rowcount={filteredResumes.length + 1}
                    className="w-full min-w-[920px] table-fixed"
                >
                    <thead className="block w-full border-b border-base-300 bg-base-200/70">
                        <tr
                            className="grid w-full items-center text-left text-sm font-semibold text-base-content/70"
                            style={{
                                gridTemplateColumns: RESUME_TABLE_COLUMNS,
                            }}
                        >
                            <th className="px-4 py-3 text-left font-semibold">
                                Resume Name
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                Work Duration
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                Highest Edu Seat
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                Skills
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    {filteredResumes.length === 0 ? (
                        <tbody className="block w-full">
                            <tr
                                className="grid w-full items-center"
                                style={{
                                    gridTemplateColumns: RESUME_TABLE_COLUMNS,
                                    minHeight: RESUME_ROW_HEIGHT,
                                }}
                            >
                                <td
                                    className="px-4 py-5 text-base-content/60"
                                    colSpan={5}
                                    style={{ gridColumn: "1 / -1" }}
                                >
                                    {data.resumes.length === 0
                                        ? "No resumes uploaded."
                                        : "No resumes match your search."}
                                </td>
                            </tr>
                        </tbody>
                    ) : (
                        <tbody
                            aria-label="Resume results"
                            className="relative block w-full overflow-y-auto"
                            data-testid="resume-virtual-list"
                            onScroll={(event) => {
                                setScrollTop(event.currentTarget.scrollTop);
                            }}
                            ref={virtualListRef}
                            style={{ height: virtualListHeight }}
                        >
                            <tr
                                aria-hidden="true"
                                className="block w-full"
                                style={{ height: totalTableHeight }}
                            >
                                <td
                                    aria-label="Resume list spacer"
                                    className="block p-0"
                                    colSpan={5}
                                />
                            </tr>
                            {visibleResumes.map((resume, index) => {
                                const itemIndex =
                                    visibleRange.startIndex + index;

                                return (
                                    <ResumeRow
                                        archivingResumeId={archivingResumeId}
                                        itemIndex={itemIndex}
                                        key={resume.resumeId}
                                        onArchive={archiveResume}
                                        resume={resume}
                                    />
                                );
                            })}
                        </tbody>
                    )}
                </table>
            </div>
            {archiveError ? (
                <p className="mt-3 text-sm text-error">{archiveError}</p>
            ) : null}
        </section>
    );
}

type ResumeRowProps = {
    archivingResumeId: string | null;
    itemIndex: number;
    onArchive: (resumeId: string) => Promise<void>;
    resume: ResumeSummary;
};

function ResumeRow({
    archivingResumeId,
    itemIndex,
    onArchive,
    resume,
}: ResumeRowProps) {
    const visibleSkills = resume.skills.slice(0, 4);
    const hiddenSkillCount = Math.max(0, resume.skills.length - 4);
    const isArchiving = archivingResumeId === resume.resumeId;

    return (
        <tr
            aria-rowindex={itemIndex + 2}
            className="absolute left-0 right-0 grid w-full items-center border-t border-base-300 bg-base-100 text-sm"
            style={{
                gridTemplateColumns: RESUME_TABLE_COLUMNS,
                height: RESUME_ROW_HEIGHT,
                transform: `translateY(${itemIndex * RESUME_ROW_HEIGHT}px)`,
            }}
        >
            <td className="min-w-0 px-4">
                <AppLink
                    className="link link-info block truncate"
                    to={`/resumes/${resume.resumeId}`}
                >
                    {resume.name}
                </AppLink>
            </td>
            <td className="truncate px-4 text-base-content/80">
                {resume.workDuration}
            </td>
            <td className="truncate px-4 text-base-content/80">
                {resume.highestEducation}
            </td>
            <td className="min-w-0 px-4">
                <div className="flex max-h-12 flex-wrap gap-2 overflow-hidden">
                    {visibleSkills.map((skill) => (
                        <span className="badge badge-outline" key={skill}>
                            {skill}
                        </span>
                    ))}
                    {hiddenSkillCount > 0 ? (
                        <span className="badge badge-ghost">
                            +{hiddenSkillCount}
                        </span>
                    ) : null}
                </div>
            </td>
            <td className="px-2 text-right">
                <button
                    aria-label={`Archive ${resume.name}`}
                    className="btn btn-ghost btn-square btn-sm text-error"
                    disabled={isArchiving}
                    onClick={() => {
                        void onArchive(resume.resumeId);
                    }}
                    title="Archive"
                    type="button"
                >
                    {isArchiving ? (
                        <span className="loading loading-spinner loading-xs" />
                    ) : (
                        <ArchiveIcon aria-hidden="true" className="h-4 w-4" />
                    )}
                </button>
            </td>
        </tr>
    );
}

type VirtualRangeInput = {
    itemCount: number;
    itemHeight: number;
    overscan: number;
    scrollTop: number;
    viewportHeight: number;
};

function getVirtualRange({
    itemCount,
    itemHeight,
    overscan,
    scrollTop,
    viewportHeight,
}: VirtualRangeInput): { endIndex: number; startIndex: number } {
    if (itemCount === 0) {
        return { endIndex: 0, startIndex: 0 };
    }

    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil(viewportHeight / itemHeight);
    const startIndex = Math.max(0, visibleStart - overscan);
    const endIndex = Math.min(
        itemCount,
        visibleStart + visibleCount + overscan,
    );

    return { endIndex, startIndex };
}

function filterResumes(
    resumes: ResumeSummary[],
    tokens: string[],
): ResumeSummary[] {
    if (tokens.length === 0) {
        return resumes;
    }

    return resumes.filter((resume) => {
        const searchText = normalizeSearchText(
            [
                resume.name,
                resume.workDuration,
                resume.highestEducation,
                ...resume.skills,
            ].join(" "),
        );

        return tokens.every((token) => searchText.includes(token));
    });
}

function tokenizeSearchQuery(query: string): string[] {
    return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function normalizeSearchText(value: string): string {
    return value.trim().toLocaleLowerCase();
}
