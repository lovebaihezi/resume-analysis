import { useParams } from "react-router-dom";
import useSWR from "swr";
import type { ApiClient } from "../apiClient";
import { useAppRuntime } from "../appRuntime";

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
        return <div className="p-8">Loading resume...</div>;
    }

    if (error || !data) {
        return <div className="p-8 text-error">Resume not found.</div>;
    }

    return (
        <section className="mx-auto max-w-5xl px-4 py-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Raw Resume</h1>
                    <p className="text-base-content/70">
                        {data.resume.basic.name}
                    </p>
                </div>
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
