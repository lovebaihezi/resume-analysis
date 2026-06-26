import { siStatuspage } from "simple-icons";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import type { ApiClient } from "../apiClient";
import { useAppRuntime } from "../appRuntime";
import { SimpleIcon } from "../components/SimpleIcon";

type InfoPageProps = {
    apiClient: ApiClient;
};

export function InfoPage({ apiClient }: InfoPageProps) {
    const params = useParams();
    // TODO(live-edit): Replace this static fetch with a resumeId-keyed document
    // session. Needed here: load the latest saved resume document, attach a Loro
    // snapshot/op-log stream, and use a prototype actor id until product auth is
    // chosen.
    const resumeId = params.resumeId ? decodeURIComponent(params.resumeId) : "";
    const { state } = useAppRuntime();
    const { data, error, isLoading } = useSWR(
        resumeId ? ["resume.info", resumeId] : null,
        ([, id]) => apiClient.getResumeInfo(id),
    );

    if (isLoading) {
        return <ResumeDetailSkeleton />;
    }

    if (error || !data) {
        return (
            <section
                aria-label="404 Error"
                className="grid min-h-[calc(100vh-4rem)] place-items-center p-8 text-error"
            >
                <SimpleIcon
                    className="h-24 w-24"
                    icon={siStatuspage}
                    label="404 Error"
                />
            </section>
        );
    }

    return (
        <section className="mx-auto max-w-5xl px-4 py-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-base-content/70">{data.resume.basic.name}</p>
                {state.context.upload.status === "done" ? (
                    <div className="badge badge-info gap-2 p-4 text-info-content">
                        {`${state.context.upload.percent}% · ${state.context.upload.bytes} bytes`}
                    </div>
                ) : null}
            </div>
            <pre className="min-h-96 overflow-auto rounded bg-base-200 p-5 text-sm leading-6">
                {JSON.stringify(data.resume, null, 4)}
            </pre>
        </section>
    );
}

function ResumeDetailSkeleton() {
    return (
        <section
            aria-label="Resume loading preview"
            className="mx-auto max-w-5xl px-4 py-8"
        >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="skeleton h-6 w-48" />
                <div className="skeleton h-8 w-28" />
            </div>
            <div className="min-h-96 rounded bg-base-200 p-5">
                <div className="space-y-3">
                    <div className="skeleton h-4 w-3/4" />
                    <div className="skeleton h-4 w-full" />
                    <div className="skeleton h-4 w-5/6" />
                    <div className="skeleton h-4 w-2/3" />
                    <div className="skeleton h-4 w-full" />
                    <div className="skeleton h-4 w-4/5" />
                </div>
            </div>
        </section>
    );
}
