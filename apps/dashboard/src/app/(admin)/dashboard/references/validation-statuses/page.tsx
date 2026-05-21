import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Validation Statuses"
            description="Reference data — Validation Statuses."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
