import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Promotion"
            description="Statistics — Promotion (not yet implemented)."
            todos={["Metrics dashboard", "Time range filters", "Export snapshots"]}
        />
    );
}
