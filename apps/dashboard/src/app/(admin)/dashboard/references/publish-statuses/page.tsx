import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Publish Statuses"
            description="Reference data — Publish Statuses."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
