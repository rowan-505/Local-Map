const STEPS = [
    { key: "scope", label: "Scope" },
    { key: "validate", label: "Validate" },
    { key: "promote", label: "Promote" },
    { key: "verify", label: "Verify" },
] as const;

export type ImportReviewPromotionStepKey = (typeof STEPS)[number]["key"];

export default function ImportReviewPromotionStepBar({
    activeStep,
}: {
    activeStep: ImportReviewPromotionStepKey;
}) {
    const activeIndex = STEPS.findIndex((s) => s.key === activeStep);

    return (
        <nav aria-label="Promotion steps" className="flex flex-wrap items-center gap-2 text-sm">
            {STEPS.map((step, index) => {
                const isActive = step.key === activeStep;
                const isDone = index < activeIndex;
                return (
                    <span key={step.key} className="inline-flex items-center gap-2">
                        {index > 0 ? (
                            <span className="text-gray-300" aria-hidden>
                                →
                            </span>
                        ) : null}
                        <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ring-1 ring-inset ${
                                isActive
                                    ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                                    : isDone
                                      ? "bg-gray-50 text-gray-700 ring-gray-200"
                                      : "bg-white text-gray-500 ring-gray-200"
                            }`}
                        >
                            <span className="tabular-nums text-xs opacity-70">{index + 1}</span>
                            {step.label}
                        </span>
                    </span>
                );
            })}
        </nav>
    );
}
