import type { ComponentProps } from "react";

import ReviewTableCard from "@/src/components/review/ReviewTableCard";

export default function CoreReviewDataTableCard(
    props: Omit<ComponentProps<typeof ReviewTableCard>, "palette">
) {
    return <ReviewTableCard {...props} palette="core" />;
}
