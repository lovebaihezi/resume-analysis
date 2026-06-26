import type { ActorRefFrom } from "xstate";
import { appMachine } from "./appMachine";

export type AppServicesActor = ActorRefFrom<typeof appMachine>;
