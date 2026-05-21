import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Import"
            description="Statistics — Import (not yet implemented)."
            todos={["Metrics dashboard", "Time range filters", "Export snapshots"]}
        />
    );
}
