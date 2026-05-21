import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Report Types"
            description="Reference data — Report Types."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
