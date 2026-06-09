"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { searchRoadTownshipAdminAreaOptions } from "@/src/lib/api";

import {
    formatAdminAreaOptionLabel,
    formatAdminAreaOptionMeta,
    type AdminAreaOption,
} from "./adminAreaLabels";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 50;

export type RoadTownshipAdminAreaComboboxProps = {
    value: string | null;
    onChange: (id: string | null) => void;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    id?: string;
};

export default function RoadTownshipAdminAreaCombobox({
    value,
    onChange,
    disabled = false,
    placeholder = "Search township…",
    className = "",
    id: idProp,
}: RoadTownshipAdminAreaComboboxProps) {
    const autoId = useId();
    const inputId = idProp ?? autoId;
    const listboxId = `${inputId}-listbox`;

    const [options, setOptions] = useState<AdminAreaOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestSeqRef = useRef(0);

    const selected = useMemo(
        () => options.find((o) => o.id === value) ?? null,
        [options, value]
    );

    const displayValue = open ? query : selected ? formatAdminAreaOptionLabel(selected) : query;

    const runSearch = useCallback(async (searchText: string) => {
        const q = searchText.trim();
        if (!q) {
            setOptions([]);
            setLoading(false);
            return;
        }

        const seq = ++requestSeqRef.current;
        setLoading(true);
        setLoadError(null);
        try {
            const rows = await searchRoadTownshipAdminAreaOptions({ q, limit: SEARCH_LIMIT });
            if (seq !== requestSeqRef.current) {
                return;
            }
            setOptions(rows);
        } catch (err) {
            if (seq !== requestSeqRef.current) {
                return;
            }
            setLoadError(err instanceof Error ? err.message : "Failed to search townships");
            setOptions([]);
        } finally {
            if (seq === requestSeqRef.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!value?.trim()) {
            return;
        }
        if (options.some((o) => o.id === value)) {
            return;
        }
        let cancelled = false;
        void searchRoadTownshipAdminAreaOptions({ q: value.trim(), limit: 1 }).then((rows) => {
            if (cancelled || rows.length === 0) {
                return;
            }
            setOptions((prev) => {
                if (prev.some((o) => o.id === rows[0]!.id)) {
                    return prev;
                }
                return [rows[0]!, ...prev];
            });
        });
        return () => {
            cancelled = true;
        };
    }, [value, options]);

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        if (!open) {
            return;
        }
        debounceRef.current = setTimeout(() => {
            void runSearch(query);
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [open, query, runSearch]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onDoc = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
                setQuery("");
            }
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const pick = useCallback(
        (opt: AdminAreaOption | null) => {
            onChange(opt?.id ?? null);
            setQuery("");
            setOpen(false);
            setActiveIndex(-1);
            if (opt) {
                setOptions((prev) => (prev.some((o) => o.id === opt.id) ? prev : [opt, ...prev]));
            }
        },
        [onChange]
    );

    const handleInputChange = (text: string) => {
        setQuery(text);
        setOpen(true);
        setActiveIndex(0);
        if (text.trim() === "") {
            onChange(null);
            setOptions([]);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, options.length - 1));
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
            return;
        }
        if (e.key === "Enter" && open && activeIndex >= 0 && options[activeIndex]) {
            e.preventDefault();
            pick(options[activeIndex]!);
            return;
        }
        if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
        }
    };

    const inputClass =
        "w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50";

    const showHint = open && !loading && query.trim().length === 0;
    const showEmpty = open && !loading && query.trim().length > 0 && options.length === 0;

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <input
                id={inputId}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-autocomplete="list"
                autoComplete="off"
                disabled={disabled}
                placeholder={placeholder}
                value={displayValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => {
                    setOpen(true);
                    setQuery(selected ? formatAdminAreaOptionLabel(selected) : "");
                }}
                onKeyDown={handleKeyDown}
                className={inputClass}
            />
            {value && !disabled ? (
                <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    aria-label="Clear township"
                    onClick={() => pick(null)}
                >
                    Clear
                </button>
            ) : null}
            {loadError ? <p className="mt-1 text-xs text-red-600">{loadError}</p> : null}
            {open && !disabled ? (
                <ul
                    id={listboxId}
                    role="listbox"
                    className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
                >
                    <li>
                        <button
                            type="button"
                            role="option"
                            className="w-full px-3 py-2 text-left text-gray-600 hover:bg-gray-50"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(null)}
                        >
                            — No township —
                        </button>
                    </li>
                    {loading ? (
                        <li className="px-3 py-2 text-gray-500">Searching…</li>
                    ) : showHint ? (
                        <li className="px-3 py-2 text-gray-500">
                            Type township name, id, public id, slug, or external id…
                        </li>
                    ) : showEmpty ? (
                        <li className="px-3 py-2 text-gray-500">No matches</li>
                    ) : (
                        options.map((opt, index) => (
                            <li key={opt.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={opt.id === value}
                                    className={`w-full px-3 py-2 text-left hover:bg-violet-50 ${
                                        index === activeIndex ? "bg-violet-50" : ""
                                    } ${opt.id === value ? "font-medium text-violet-900" : "text-gray-900"}`}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => pick(opt)}
                                >
                                    <span className="block font-medium">
                                        {formatAdminAreaOptionLabel(opt)}
                                    </span>
                                    {formatAdminAreaOptionMeta(opt) ? (
                                        <span className="mt-0.5 block text-xs text-gray-500">
                                            {formatAdminAreaOptionMeta(opt)}
                                        </span>
                                    ) : null}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            ) : null}
        </div>
    );
}
