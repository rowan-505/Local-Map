import { Suspense } from "react";

import LoginPageClient from "./LoginPageClient";

export default function LoginPage() {
    return (
        <Suspense fallback={
            <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
                <p className="text-sm text-gray-600">Checking authentication…</p>
            </main>
        }>
            <LoginPageClient />
        </Suspense>
    );
}
