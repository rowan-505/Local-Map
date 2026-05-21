import type { ComponentProps } from "react";

import ReviewFilterCard from "@/src/components/review/ReviewFilterCard";

export default function CoreReviewFilterCard(
    props: Omit<ComponentProps<typeof ReviewFilterCard>, "palette">
) {
    return <ReviewFilterCard {...props} palette="core" />;
}
