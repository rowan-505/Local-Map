import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Data Quality"
            description="Statistics — Data Quality (not yet implemented)."
            todos={["Metrics dashboard", "Time range filters", "Export snapshots"]}
        />
    );
}
