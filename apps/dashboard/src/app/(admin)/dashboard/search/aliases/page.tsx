import { Suspense } from "react";

import SearchAliasesPage from "@/src/features/search/SearchAliasesPage";

export default function SearchAliasesRoutePage() {
    return (
        <Suspense
            fallback={
                <main className="p-6">
                    <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
                        Loading search aliases…
                    </div>
                </main>
            }
        >
            <SearchAliasesPage />
        </Suspense>
    );
}
