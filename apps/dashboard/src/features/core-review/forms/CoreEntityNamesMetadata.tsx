"use client";

type NameRow = {
    id?: string;
    name: string;
    language_code?: string | null;
    name_type?: string;
    is_primary?: boolean;
};

export type CoreEntityNamesMetadataProps = {
    names: NameRow[] | null | undefined;
    title?: string;
};

export default function CoreEntityNamesMetadata({
    names,
    title = "Name records",
}: CoreEntityNamesMetadataProps) {
    if (!names || names.length === 0) {
        return null;
    }

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <ul className="mt-3 space-y-2">
                {names.map((row) => (
                    <li
                        key={row.id ?? `${row.name}-${row.language_code ?? ""}-${row.name_type ?? ""}`}
                        className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                        <span className="font-medium">{row.name}</span>
                        {row.language_code ? (
                            <span className="ml-2 text-xs text-slate-500">{row.language_code}</span>
                        ) : null}
                        {row.name_type ? (
                            <span className="ml-2 text-xs text-slate-500">{row.name_type}</span>
                        ) : null}
                        {row.is_primary ? (
                            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-800">
                                Primary
                            </span>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}
