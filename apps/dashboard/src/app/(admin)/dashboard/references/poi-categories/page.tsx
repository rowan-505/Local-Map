import FamilyPlaceholderPage from "@/src/components/dashboard/FamilyPlaceholderPage";

export default function PoiCategoriesPage() {
    return (
        <FamilyPlaceholderPage
            title="POI categories"
            description="Category reference data for places and points of interest."
            todos={[
                "List and edit POI category records",
                "Hierarchy and display order",
                "Link categories to place classes",
            ]}
        />
    );
}
