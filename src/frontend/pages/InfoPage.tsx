import { siStatuspage } from "simple-icons";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import type { ApiClient } from "../apiClient";
import { useAppRuntime } from "../appRuntime";
import {
    ResumeDetailSkeleton,
    ResumeDetailView,
} from "../components/ResumeDetailView";
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
            {state.context.upload.status === "done" ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="badge badge-info gap-2 p-4 text-info-content">
                        {`${state.context.upload.percent}% · ${state.context.upload.bytes} bytes`}
                    </div>
                </div>
            ) : null}
            <ResumeDetailView resume={data.resume} />
        </section>
    );
}
