import type { ReactNode } from "react";

/** Legacy route tree — pages redirect to Core Review; no module nav rendered here. */
export default function CoreVerificationLayout({ children }: { children: ReactNode }) {
    return children;
}
