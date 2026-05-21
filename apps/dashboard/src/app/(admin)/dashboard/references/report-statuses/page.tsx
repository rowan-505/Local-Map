import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Report Statuses"
            description="Reference data — Report Statuses."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
