"use client";

import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";

import { listSearchDocuments } from "./api";
import { entityTypeLabel, SEARCH_ALIAS_ENTITY_TYPES } from "./constants";
import type { SearchDocumentItem } from "./types";
import { INPUT_CLASS, SECONDARY_BTN, SELECT_CLASS } from "./ui";

export type SelectedSearchEntity = {
    entity_type: string;
    entity_id: string;
    display_name: string;
    public_id: string | null;
};

export default function SearchEntityPicker({
    value,
    onChange,
    disabled = false,
    initialQuery = "",
}: {
    value: SelectedSearchEntity | null;
    onChange: (entity: SelectedSearchEntity | null) => void;
    disabled?: boolean;
    initialQuery?: string;
}) {
    const [query, setQuery] = useState(initialQuery);
    const [entityType, setEntityType] = useState("");
    const [results, setResults] = useState<SearchDocumentItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setQuery(initialQuery);
    }, [initialQuery]);

    const search = useCallback(
        async (q: string, type: string, signal?: AbortSignal) => {
            const trimmed = q.trim();
            if (trimmed.length < 2) {
                setResults([]);
                setError("");
                return;
            }
            setLoading(true);
            setError("");
            try {
                const res = await listSearchDocuments(
                    {
                        q: trimmed,
                        entity_type: type || undefined,
                        is_active: true,
                        is_public: true,
                        page: 1,
                        pageSize: 8,
                        sort: "name",
                        order: "asc",
                    },
                    signal ? { signal } : undefined,
                );
                setResults(res.items);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Entity search failed.");
                setResults([]);
            } finally {
                setLoading(false);
            }
        },
        [],
    );

    useEffect(() => {
        const controller = new AbortController();
        const handle = window.setTimeout(() => {
            void search(query, entityType, controller.signal);
        }, 300);
        return () => {
            window.clearTimeout(handle);
            controller.abort();
        };
    }, [query, entityType, search]);

    if (disabled && value) {
        return (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="font-medium text-gray-900">{value.display_name}</div>
                <div className="mt-1 text-gray-600">
                    {entityTypeLabel(value.entity_type)} · id {value.entity_id}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                    Linked entity cannot be changed when editing an alias.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {value ? (
                <div className="flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                    <div>
                        <div className="font-medium text-emerald-950">{value.display_name}</div>
                        <div className="mt-1 text-emerald-900/80">
                            {entityTypeLabel(value.entity_type)} · id {value.entity_id}
                        </div>
                    </div>
                    <button
                        type="button"
                        className={SECONDARY_BTN}
                        onClick={() => onChange(null)}
                    >
                        Change
                    </button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]">
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search indexed entities by name or id…"
                            className={INPUT_CLASS}
                        />
                        <select
                            value={entityType}
                            onChange={(e) => setEntityType(e.target.value)}
                            className={SELECT_CLASS}
                        >
                            <option value="">All types</option>
                            {SEARCH_ALIAS_ENTITY_TYPES.map((type) => (
                                <option key={type} value={type}>
                                    {entityTypeLabel(type)}
                                </option>
                            ))}
                        </select>
                    </div>
                    {error ? (
                        <p className="text-sm text-red-700">{error}</p>
                    ) : null}
                    {loading ? (
                        <p className="text-sm text-gray-500">Searching indexed entities…</p>
                    ) : null}
                    {!loading && query.trim().length >= 2 && results.length === 0 ? (
                        <p className="text-sm text-gray-500">No indexed entities found.</p>
                    ) : null}
                    {results.length > 0 ? (
                        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-gray-200 bg-white p-1">
                            {results.map((item) => (
                                <li key={`${item.entity_type}:${item.entity_id}`}>
                                    <button
                                        type="button"
                                        className="w-full rounded px-2 py-2 text-left text-sm hover:bg-gray-50"
                                        onClick={() =>
                                            onChange({
                                                entity_type: item.entity_type,
                                                entity_id: item.entity_id,
                                                display_name: item.display_name ?? "Untitled",
                                                public_id: item.public_id,
                                            })
                                        }
                                    >
                                        <div className="font-medium text-gray-900 break-words [overflow-wrap:anywhere]">
                                            {item.display_name ?? "Untitled"}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {entityTypeLabel(item.entity_type)} · id {item.entity_id}
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </>
            )}
        </div>
    );
}
