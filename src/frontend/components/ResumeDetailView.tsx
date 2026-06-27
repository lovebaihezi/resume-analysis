import type {
    Edu,
    Project,
    ResumeAnalysis,
    Skill,
    Work,
} from "../../shared/types";

type ResumeDetailViewProps = {
    headingId?: string;
    resume: ResumeAnalysis;
};

type TimelineEntry = {
    description?: string;
    emptyDetailLabel: string;
    id: string;
    meta: string[];
    side: Array<{ label: string; value: string }>;
    subtitle?: string;
    tips: Array<{ label: string; tip: string }>;
    title: string;
};

export function ResumeDetailView({
    headingId = "resume-detail-name",
    resume,
}: ResumeDetailViewProps) {
    return (
        <article aria-labelledby={headingId} className="space-y-8">
            <BasicSection headingId={headingId} resume={resume} />
            <TimelineSection
                emptyLabel="No education provided."
                entries={resume.edu.map(toEducationEntry)}
                titleId={`${headingId}-edu-title`}
                title="Edu"
            />
            <TimelineSection
                emptyLabel="No work history provided."
                entries={resume.work.map(toWorkEntry)}
                titleId={`${headingId}-work-title`}
                title="Work"
            />
            <TimelineSection
                emptyLabel="No projects provided."
                entries={resume.project.map(toProjectEntry)}
                titleId={`${headingId}-project-title`}
                title="Project"
            />
            <SkillsSection
                skills={resume.skills}
                titleId={`${headingId}-skills-title`}
            />
        </article>
    );
}

export function ResumeDetailSkeleton() {
    return (
        <section
            aria-label="Resume loading preview"
            className="mx-auto max-w-5xl px-4 py-8"
        >
            <div className="space-y-8">
                <section className="border-b border-base-300 pb-6">
                    <div className="skeleton h-10 w-64 max-w-full" />
                    <div className="mt-4 flex gap-2 overflow-hidden">
                        <div className="skeleton h-8 w-28 shrink-0" />
                        <div className="skeleton h-8 w-36 shrink-0" />
                        <div className="skeleton h-8 w-32 shrink-0" />
                    </div>
                </section>
                {["edu", "work", "project"].map((item) => (
                    <section className="space-y-4" key={item}>
                        <div className="skeleton h-7 w-24" />
                        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)]">
                            <div className="skeleton h-16 w-full" />
                            <div className="hidden md:block" />
                            <div className="skeleton h-24 w-full" />
                        </div>
                    </section>
                ))}
            </div>
        </section>
    );
}

function BasicSection({
    headingId,
    resume,
}: {
    headingId: string;
    resume: ResumeAnalysis;
}) {
    const links = [
        resume.basic.email
            ? {
                  href: `mailto:${resume.basic.email}`,
                  label: resume.basic.email,
              }
            : undefined,
        resume.basic.phone
            ? {
                  href: `tel:${resume.basic.phone}`,
                  label: resume.basic.phone,
              }
            : undefined,
        ...resume.basic.socialMedia.map((social) => ({
            href: social.link,
            label: social.name,
        })),
    ].filter((link): link is { href: string; label: string } => Boolean(link));

    return (
        <section
            aria-labelledby={headingId}
            className="border-b border-base-300 pb-6"
        >
            <h1
                className="truncate whitespace-nowrap text-[32px] font-semibold leading-tight"
                id={headingId}
                title={resume.basic.name}
            >
                {resume.basic.name}
            </h1>
            {links.length > 0 ? (
                <div
                    aria-label="Resume contact links"
                    className="mt-4 flex flex-nowrap gap-2 overflow-x-auto pb-1"
                >
                    {links.map((link) => (
                        <a
                            className="badge badge-outline h-auto shrink-0 whitespace-nowrap px-3 py-2 text-sm"
                            data-xstate-ignore="true"
                            href={link.href}
                            key={`${link.label}-${link.href}`}
                            rel={
                                link.href.startsWith("http")
                                    ? "noreferrer"
                                    : undefined
                            }
                            target={
                                link.href.startsWith("http")
                                    ? "_blank"
                                    : undefined
                            }
                        >
                            {link.label}
                        </a>
                    ))}
                </div>
            ) : null}
        </section>
    );
}

function TimelineSection({
    emptyLabel,
    entries,
    title,
    titleId,
}: {
    emptyLabel: string;
    entries: TimelineEntry[];
    title: "Edu" | "Work" | "Project";
    titleId: string;
}) {
    return (
        <section aria-labelledby={titleId} className="space-y-4">
            <h2 className="text-xl font-semibold" id={titleId}>
                {title}
            </h2>
            {entries.length === 0 ? (
                <p className="text-sm text-base-content/60">{emptyLabel}</p>
            ) : (
                <ol className="relative space-y-7 before:absolute before:bottom-0 before:left-3 before:top-0 before:w-px before:bg-base-300 md:before:left-1/2">
                    {entries.map((entry, index) => (
                        <TimelineItem
                            entry={entry}
                            index={index}
                            key={entry.id}
                        />
                    ))}
                </ol>
            )}
        </section>
    );
}

function TimelineItem({
    entry,
    index,
}: {
    entry: TimelineEntry;
    index: number;
}) {
    const isEven = index % 2 === 0;
    const sideClass = isEven
        ? "md:col-start-1 md:pr-6 md:text-right"
        : "md:col-start-3 md:pl-6";
    const detailClass = isEven
        ? "md:col-start-3 md:pl-6"
        : "md:col-start-1 md:row-start-1 md:pr-6 md:text-right";

    return (
        <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-y-3 pl-0 md:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] md:gap-y-0">
            <span
                aria-hidden="true"
                className="absolute left-3 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-base-100 md:left-1/2"
            />
            <div
                className={`col-start-2 text-sm text-base-content/70 ${sideClass}`}
            >
                <dl className="inline-grid max-w-full gap-1">
                    {entry.side.map((item) => (
                        <div
                            className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 md:block"
                            key={`${item.label}-${item.value}`}
                        >
                            <dt className="text-xs uppercase tracking-wide text-base-content/50">
                                {item.label}
                            </dt>
                            <dd className="truncate font-medium text-base-content">
                                {item.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>
            <div className={`col-start-2 min-w-0 ${detailClass}`}>
                <div
                    className={`flex flex-wrap items-center gap-2 ${
                        isEven ? "" : "md:justify-end"
                    }`}
                >
                    <h3 className="min-w-0 truncate text-base font-semibold">
                        {entry.title}
                    </h3>
                    {entry.subtitle ? (
                        <span className="badge badge-primary badge-outline shrink-0">
                            {entry.subtitle}
                        </span>
                    ) : null}
                </div>
                {entry.description ? (
                    <p className="mt-2 text-sm leading-6 text-base-content/80">
                        {entry.description}
                    </p>
                ) : (
                    <p className="mt-2 text-sm text-base-content/50">
                        {entry.emptyDetailLabel}
                    </p>
                )}
                {entry.meta.length > 0 ? (
                    <div
                        className={`mt-3 flex flex-wrap gap-2 ${
                            isEven ? "" : "md:justify-end"
                        }`}
                    >
                        {entry.meta.map((item) => (
                            <span className="badge badge-ghost" key={item}>
                                {item}
                            </span>
                        ))}
                    </div>
                ) : null}
                {entry.tips.length > 0 ? (
                    <div
                        className={`mt-3 flex flex-wrap gap-2 ${
                            isEven ? "" : "md:justify-end"
                        }`}
                    >
                        {entry.tips.map((tip) => (
                            <span
                                aria-label={tip.tip}
                                className="tooltip tooltip-top"
                                data-tip={tip.tip}
                                key={`${tip.label}-${tip.tip}`}
                                title={tip.tip}
                            >
                                <span className="badge badge-info badge-outline">
                                    {tip.label}
                                </span>
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </li>
    );
}

function SkillsSection({
    skills,
    titleId,
}: {
    skills: Skill[];
    titleId: string;
}) {
    return (
        <section aria-labelledby={titleId} className="space-y-4">
            <h2 className="text-xl font-semibold" id={titleId}>
                Skills
            </h2>
            {skills.length === 0 ? (
                <p className="text-sm text-base-content/60">
                    No skills provided.
                </p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {skills.map((skill) =>
                        skill.des ? (
                            <span
                                aria-label={`${skill.name}: ${skill.des}`}
                                className="tooltip tooltip-top"
                                data-tip={skill.des}
                                key={skill.name}
                                title={skill.des}
                            >
                                <span className="badge badge-outline h-auto px-3 py-2">
                                    {skill.name}
                                </span>
                            </span>
                        ) : (
                            <span
                                className="badge badge-outline h-auto px-3 py-2"
                                key={skill.name}
                            >
                                {skill.name}
                            </span>
                        ),
                    )}
                </div>
            )}
        </section>
    );
}

function toEducationEntry(edu: Edu): TimelineEntry {
    const awardTips = edu.awards.map((award) => ({
        label: award.name,
        tip: `${award.name}: ${award.value}`,
    }));
    const experienceTips = edu.experiences.map((experience, index) => ({
        label: `Experience ${index + 1}`,
        tip: experience.des,
    }));

    return {
        description: edu.experiences
            .map((experience) => experience.des)
            .join(" "),
        emptyDetailLabel: "No education details provided.",
        id: stableEntryId("edu", [
            edu.school,
            edu.degree,
            ...edu.awards.map((award) => `${award.name}:${award.value}`),
        ]),
        meta: edu.awards.map((award) => `${award.name} ${award.value}`),
        side: [
            {
                label: "Degree",
                value: edu.degree ?? "Unknown",
            },
            {
                label: "Awards",
                value: String(edu.awards.length),
            },
        ],
        subtitle: edu.degree,
        tips: [...awardTips, ...experienceTips],
        title: edu.school ?? "Education",
    };
}

function toWorkEntry(work: Work): TimelineEntry {
    return {
        description: work.des,
        emptyDetailLabel: "No work details provided.",
        id: stableEntryId("work", [work.company, work.role, ...work.duration]),
        meta: [work.type, work.location, work.level].filter(isPresent),
        side: durationSide(work.duration),
        subtitle: work.role,
        tips: detailTips([
            ["Company", work.company],
            ["Role", work.role],
            ["Level", work.level],
            ["Location", work.location],
            ["Type", work.type],
        ]),
        title: work.company ?? "Work",
    };
}

function toProjectEntry(project: Project): TimelineEntry {
    return {
        description: project.des,
        emptyDetailLabel: "No project details provided.",
        id: stableEntryId("project", [
            project.name,
            project.role,
            ...project.duration,
        ]),
        meta: [project.type, project.role].filter(isPresent),
        side: durationSide(project.duration),
        subtitle: project.role,
        tips: detailTips([
            ["Project", project.name],
            ["Role", project.role],
            ["Type", project.type],
        ]),
        title: project.name ?? "Project",
    };
}

function durationSide(duration: string[]): TimelineEntry["side"] {
    const [start, end] = duration;

    return [
        {
            label: "Start",
            value: formatDateValue(start),
        },
        {
            label: "End",
            value: formatDateValue(end),
        },
    ];
}

function detailTips(
    details: Array<[label: string, value: string | undefined]>,
): TimelineEntry["tips"] {
    return details
        .filter((detail): detail is [string, string] => isPresent(detail[1]))
        .map(([label, value]) => ({
            label,
            tip: `${label}: ${value}`,
        }));
}

function stableEntryId(
    prefix: "edu" | "work" | "project",
    parts: Array<string | undefined>,
): string {
    const key = parts.filter(isPresent).join("|");

    return key ? `${prefix}:${key}` : prefix;
}

function formatDateValue(value: string | undefined): string {
    if (!value) {
        return "Unknown";
    }

    const dateOnly = value.match(/^(\d{4})(?:-(\d{2}))?/);

    if (dateOnly) {
        const [, year, month] = dateOnly;
        const date = new Date(Number(year), Number(month ?? "1") - 1, 1);

        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            year: "numeric",
        }).format(date);
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        year: "numeric",
    }).format(date);
}

function isPresent<T extends string>(value: T | undefined): value is T {
    return Boolean(value?.trim());
}
