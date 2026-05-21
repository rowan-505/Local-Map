import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Core"
            description="Statistics — Core (not yet implemented)."
            todos={["Metrics dashboard", "Time range filters", "Export snapshots"]}
        />
    );
}
