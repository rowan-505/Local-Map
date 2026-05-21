import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Validation Task Types"
            description="Reference data — Validation Task Types."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
