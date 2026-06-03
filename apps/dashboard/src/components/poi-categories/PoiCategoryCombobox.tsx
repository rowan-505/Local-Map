"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
    filterPoiCategoryDropdownOptions,
    getPoiCategoryDisplayText,
    isPoiParentCategory,
    type PoiCategoryDropdownOption,
} from "@/src/lib/poi-category/display";

function PoiCategoryOptionLabel({ option }: { option: PoiCategoryDropdownOption }) {
    return (
        <span className="inline-flex items-center gap-2">
            {isPoiParentCategory(option) ? (
                <span className="text-red-500/70 text-xs" aria-hidden="true">
                    ★
                </span>
            ) : null}
            <span>{getPoiCategoryDisplayText(option)}</span>
        </span>
    );
}

export type PoiCategoryComboboxProps = {
    value: string;
    onChange: (id: string) => void;
    options: PoiCategoryDropdownOption[];
    disabled?: boolean;
    optionsLoading?: boolean;
    placeholder?: string;
    className?: string;
    id?: string;
    emptyOptionLabel?: string;
    allowEmpty?: boolean;
};

export default function PoiCategoryCombobox({
    value,
    onChange,
    options,
    disabled = false,
    optionsLoading = false,
    placeholder = "Search category…",
    className = "",
    id: idProp,
    emptyOptionLabel = "No category",
    allowEmpty = true,
}: PoiCategoryComboboxProps) {
    const autoId = useId();
    const inputId = idProp ?? autoId;
    const listboxId = `${inputId}-listbox`;

    const [filterQuery, setFilterQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

    const selected = useMemo(
        () => options.find((option) => option.value === value || option.id === value) ?? null,
        [options, value]
    );

    const filtered = useMemo(
        () => filterPoiCategoryDropdownOptions(options, filterQuery),
        [options, filterQuery]
    );

    const displayValue = open
        ? filterQuery
        : selected
          ? getPoiCategoryDisplayText(selected)
          : filterQuery;

    const closeList = useCallback(() => {
        setOpen(false);
        setFilterQuery("");
        setActiveIndex(-1);
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onDoc = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                closeList();
            }
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [closeList, open]);

    const pick = useCallback(
        (option: PoiCategoryDropdownOption | null) => {
            onChange(option?.value ?? "");
            closeList();
        },
        [closeList, onChange]
    );

    const handleInputChange = (text: string) => {
        setFilterQuery(text);
        setOpen(true);
        setActiveIndex(0);
        if (allowEmpty && text.trim() === "") {
            onChange("");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
            return;
        }
        if (e.key === "Enter" && open && activeIndex >= 0 && filtered[activeIndex]) {
            e.preventDefault();
            pick(filtered[activeIndex]!);
            return;
        }
        if (e.key === "Escape") {
            closeList();
        }
    };

    const inputClass =
        "w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50";

    const showSelectedStar = Boolean(selected && !open && isPoiParentCategory(selected));

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <div className="relative">
                {showSelectedStar ? (
                    <span
                        className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-red-500/70 text-xs"
                        aria-hidden="true"
                    >
                        ★
                    </span>
                ) : null}
                <input
                    id={inputId}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    autoComplete="off"
                    disabled={disabled || optionsLoading}
                    placeholder={optionsLoading ? "Loading categories…" : placeholder}
                    value={displayValue}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onFocus={() => {
                        setOpen(true);
                        setFilterQuery("");
                        setActiveIndex(-1);
                    }}
                    onKeyDown={handleKeyDown}
                    className={`${inputClass} ${showSelectedStar ? "pl-6" : ""}`}
                />
            </div>
            {open && !disabled && !optionsLoading ? (
                <ul
                    id={listboxId}
                    role="listbox"
                    className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
                >
                    {allowEmpty ? (
                        <li>
                            <button
                                type="button"
                                role="option"
                                className="w-full px-3 py-2 text-left text-gray-600 hover:bg-gray-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pick(null)}
                            >
                                {emptyOptionLabel}
                            </button>
                        </li>
                    ) : null}
                    {filtered.length === 0 ? (
                        <li className="px-3 py-2 text-gray-500">No matches</li>
                    ) : (
                        filtered.map((option, index) => (
                            <li key={option.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={option.value === value}
                                    className={`w-full px-3 py-2 text-left hover:bg-violet-50 ${
                                        index === activeIndex ? "bg-violet-50" : ""
                                    } ${option.value === value ? "font-medium text-violet-900" : "text-gray-900"}`}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => pick(option)}
                                >
                                    <PoiCategoryOptionLabel option={option} />
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            ) : null}
        </div>
    );
}
