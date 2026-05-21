"use client";

/**
 * Top tab navigation for review families (import review, core review).
 * Re-exports {@link FamilyTopNav} — active tab uses dark background per design system.
 */
export { default } from "@/src/components/dashboard/FamilyTopNav";
export { default as ReviewTopNavFromConfig } from "@/src/components/dashboard/FamilyTopNavFromConfig";
export type { FamilyTopNavTab as ReviewTopNavTab } from "@/src/components/dashboard/FamilyTopNav";
