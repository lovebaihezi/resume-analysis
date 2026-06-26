import { createContext, useContext } from "react";
import type { SnapshotFrom } from "xstate";
import type { AppServicesActor } from "./types";
import { appMachine } from "./appMachine";

export type AppSnapshot = SnapshotFrom<typeof appMachine>;

export type AppRuntimeValue = {
    send: AppServicesActor["send"];
    state: AppSnapshot;
};

export const AppRuntimeContext = createContext<AppRuntimeValue | undefined>(
    undefined,
);

export function useAppRuntime(): AppRuntimeValue {
    const value = useContext(AppRuntimeContext);

    if (!value) {
        throw new Error("useAppRuntime must be used inside AppRuntimeContext");
    }

    return value;
}
