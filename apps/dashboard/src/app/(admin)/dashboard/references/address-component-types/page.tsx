import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function Page() {
    return (
        <FamilyPlaceholderPage
            title="Address Component Types"
            description="Reference data — Address Component Types."
            todos={["CRUD table for reference rows", "API integration", "Validation rules"]}
        />
    );
}
