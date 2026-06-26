import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useAppRuntime } from "../appRuntime";

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    children: ReactNode;
    to: string;
};

export function AppLink({ children, onClick, to, ...props }: AppLinkProps) {
    const { send } = useAppRuntime();

    return (
        <a
            {...props}
            data-xstate-link="true"
            href={to}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                onClick?.(event);

                if (
                    event.defaultPrevented ||
                    shouldUseNativeNavigation(event)
                ) {
                    return;
                }

                event.preventDefault();
                send({ type: "NAVIGATE", to });
            }}
        >
            {children}
        </a>
    );
}

export function allowNativeLinkProps(): {
    "data-xstate-ignore": "true";
} {
    return {
        "data-xstate-ignore": "true",
    };
}

function shouldUseNativeNavigation(
    event: MouseEvent<HTMLAnchorElement>,
): boolean {
    return (
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
    );
}
