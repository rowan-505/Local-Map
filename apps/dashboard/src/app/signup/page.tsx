import { redirect } from "next/navigation";

/**
 * Public/demo dashboard signup has been removed. Accounts are provisioned by a
 * super admin. This route only redirects to /login so the old URL never shows a
 * signup form.
 */
export default function SignupPage() {
    redirect("/login");
}
