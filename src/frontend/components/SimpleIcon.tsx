import type { SVGProps } from "react";
import type { SimpleIcon as SimpleIconData } from "simple-icons";

type SimpleIconProps = Omit<SVGProps<SVGSVGElement>, "children" | "viewBox"> & {
    icon: SimpleIconData;
    label?: string;
};

export function SimpleIcon({ icon, label, ...props }: SimpleIconProps) {
    return (
        <svg
            aria-hidden={label ? undefined : "true"}
            aria-label={label}
            fill="currentColor"
            role={label ? "img" : undefined}
            viewBox="0 0 24 24"
            {...props}
        >
            {label ? <title>{label}</title> : null}
            <path d={icon.path} />
        </svg>
    );
}
