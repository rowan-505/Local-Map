/** Label for the list-page create button derived from entity title. */
export function coreReviewCreateButtonLabel(title: string): string {
    if (title === "Addresses") {
        return "Add Address";
    }
    if (title.endsWith("s")) {
        return `Add ${title.slice(0, -1)}`;
    }
    return `Add ${title}`;
}
