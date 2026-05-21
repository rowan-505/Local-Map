import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function ReferencesOverviewPage() {
    return (
        <FamilyPlaceholderPage
            title="References"
            description="Lookup tables and controlled vocabularies used across core and import review."
            todos={[
                "Reference data index with counts",
                "Bulk import/export for reference tables",
                "Audit log for reference changes",
            ]}
        />
    );
}
