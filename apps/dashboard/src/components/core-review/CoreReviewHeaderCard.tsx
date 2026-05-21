import type { ComponentProps } from "react";

import ReviewHeaderCard from "@/src/components/review/ReviewHeaderCard";

export default function CoreReviewHeaderCard(
    props: Omit<ComponentProps<typeof ReviewHeaderCard>, "palette">
) {
    return <ReviewHeaderCard {...props} palette="core" />;
}
