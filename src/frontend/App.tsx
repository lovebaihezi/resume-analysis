import * as stylex from "@stylexjs/stylex";
import { useMachine } from "@xstate/react";
import { useMemo } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { SWRConfig } from "swr";
import { appMachine } from "./appMachine";
import { AppRuntimeContext } from "./appRuntime";
import type { ApiClient } from "./apiClient";
import { browserApiClient } from "./apiClient";
import { Navbar } from "./components/Navbar";
import { HomePage } from "./pages/HomePage";
import { InfoPage } from "./pages/InfoPage";
import { JdPage } from "./pages/JdPage";
import { ResumesPage } from "./pages/ResumesPage";
import "./styles.css";

type AppProps = {
    apiClient?: ApiClient;
    initialEntries?: string[];
};

const styles = stylex.create({
    shell: {
        backgroundColor: "var(--color-base-200)",
        minHeight: "100vh",
    },
});

export function App({
    apiClient = browserApiClient,
    initialEntries,
}: AppProps) {
    if (typeof window !== "undefined" && initialEntries?.[0]) {
        const target = initialEntries[0];

        if (window.location.pathname !== target) {
            window.history.replaceState(null, "", target);
        }
    }

    return (
        <BrowserRouter>
            <AppRuntime apiClient={apiClient} />
        </BrowserRouter>
    );
}

function AppRuntime({ apiClient }: { apiClient: ApiClient }) {
    const navigate = useNavigate();
    const [state, send] = useMachine(appMachine, {
        input: {
            navigate,
        },
    });
    const runtimeValue = useMemo(() => ({ send, state }), [send, state]);

    return (
        <AppRuntimeContext.Provider value={runtimeValue}>
            <SWRConfig
                value={{
                    revalidateOnFocus: false,
                }}
            >
                <div {...stylex.props(styles.shell)}>
                    <Navbar apiClient={apiClient} />
                    <main>
                        <Routes>
                            <Route
                                element={<HomePage apiClient={apiClient} />}
                                path="/"
                            />
                            <Route
                                element={<ResumesPage apiClient={apiClient} />}
                                path="/resumes"
                            />
                            <Route
                                element={<JdPage apiClient={apiClient} />}
                                path="/jd"
                            />
                            <Route
                                element={<InfoPage apiClient={apiClient} />}
                                path="/info/:name"
                            />
                        </Routes>
                    </main>
                </div>
            </SWRConfig>
        </AppRuntimeContext.Provider>
    );
}
