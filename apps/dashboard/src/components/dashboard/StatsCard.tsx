import { Card, CardContent } from "@/src/components/ui/card";
import { cn } from "@/src/lib/cn";

export type StatsCardStatusColor = "default" | "success" | "warning" | "danger";

const STATUS_ACCENT: Record<Exclude<StatsCardStatusColor, "default">, string> = {
    success: "border-l-emerald-600",
    warning: "border-l-amber-500",
    danger: "border-l-red-600",
};

export type StatsCardProps = {
    title: string;
    value: string | number;
    description?: string;
    /** Accent stripe on the left; `default` uses the neutral card border only. */
    statusColor?: StatsCardStatusColor;
    className?: string;
};

function formatDisplayValue(value: string | number): string {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value.toLocaleString();
    }

    return String(value);
}

/**
 * KPI tile: large numeric value with muted title/description. Built on shadcn-style Card primitives.
 */
export default function StatsCard({
    title,
    value,
    description,
    statusColor = "default",
    className,
}: StatsCardProps) {
    return (
        <Card
            className={cn(
                statusColor !== "default" &&
                    cn("border-l-[3px]", STATUS_ACCENT[statusColor]),
                className
            )}
        >
            <CardContent className="pb-6 pt-6">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
                <p className="mt-3 min-w-0 wrap-break-word text-3xl font-bold tabular-nums tracking-tight text-gray-900 sm:text-4xl">
                    {formatDisplayValue(value)}
                </p>
                {description ? (
                    <p className="mt-2 text-sm leading-snug text-gray-600">{description}</p>
                ) : null}
            </CardContent>
        </Card>
    );
}
