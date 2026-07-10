import { trimName } from "./derive-display-name.js";

export type TransportStopDisplayLang = "my" | "en" | "und";

export function resolveTransportStopDisplayName(args: {
    lang?: TransportStopDisplayLang | null;
    name_mm: string | null | undefined;
    name_en: string | null | undefined;
    name_und: string | null | undefined;
    canonical_name: string | null | undefined;
    typeFallback?: string;
}): string {
    const name_mm = trimName(args.name_mm);
    const name_en = trimName(args.name_en);
    const name_und = trimName(args.name_und);
    const canonical_name = trimName(args.canonical_name);
    const typeFallback = trimName(args.typeFallback) ?? "Unnamed stop";

    if (args.lang === "my" && name_mm) return name_mm;
    if (args.lang === "en" && name_en) return name_en;
    if (args.lang === "und" && name_und) return name_und;

    return name_mm ?? name_en ?? name_und ?? canonical_name ?? typeFallback;
}
