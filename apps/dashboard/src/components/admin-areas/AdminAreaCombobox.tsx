"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { getAdminAreaOptions } from "@/src/lib/api";

import { formatAdminAreaOptionLabel, type AdminAreaOption } from "./adminAreaLabels";

export type AdminAreaComboboxProps = {
    /** Admin area id as string (bigint from API). */
    value: string | null;
    onChange: (id: string | null) => void;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    id?: string;
};

export default function AdminAreaCombobox({
    value,
    onChange,
    disabled = false,
    placeholder = "Search admin area…",
    className = "",
    id: idProp,
}: AdminAreaComboboxProps) {
    const autoId = useId();
    const inputId = idProp ?? autoId;
    const listboxId = `${inputId}-listbox`;

    const [options, setOptions] = useState<AdminAreaOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

    const selected = useMemo(
        () => options.find((o) => o.id === value) ?? null,
        [options, value]
    );

    const displayValue = open ? query : selected ? formatAdminAreaOptionLabel(selected) : query;

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return options;
        }
        return options.filter((opt) => {
            const label = formatAdminAreaOptionLabel(opt).toLowerCase();
            const canon = opt.canonical_name.toLowerCase();
            return label.includes(q) || canon.includes(q) || opt.id.includes(q);
        });
    }, [options, query]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        void getAdminAreaOptions({ limit: 2000 })
            .then((rows) => {
                if (!cancelled) {
                    setOptions(rows);
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setLoadError(err instanceof Error ? err.message : "Failed to load admin areas");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

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
        },
        [onChange]
    );

    const handleInputChange = (text: string) => {
        setQuery(text);
        setOpen(true);
        setActiveIndex(0);
        if (text.trim() === "") {
            onChange(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
            return;
        }
        if (e.key === "Enter" && open && activeIndex >= 0 && filtered[activeIndex]) {
            e.preventDefault();
            pick(filtered[activeIndex]!);
            return;
        }
        if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
        }
    };

    const inputClass =
        "w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50";

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
                disabled={disabled || loading}
                placeholder={loading ? "Loading admin areas…" : placeholder}
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
                    aria-label="Clear admin area"
                    onClick={() => pick(null)}
                >
                    Clear
                </button>
            ) : null}
            {loadError ? <p className="mt-1 text-xs text-red-600">{loadError}</p> : null}
            {open && !disabled && !loading ? (
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
                            — No admin area —
                        </button>
                    </li>
                    {filtered.length === 0 ? (
                        <li className="px-3 py-2 text-gray-500">No matches</li>
                    ) : (
                        filtered.map((opt, index) => (
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
                                    {formatAdminAreaOptionLabel(opt)}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            ) : null}
        </div>
    );
}
