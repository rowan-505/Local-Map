import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@/features/filters/useDebouncedValue';
import { searchRegions, type RegionOption } from '../api/regionsApi';

/**
 * Searchable region/township picker (controlled).
 *
 * The parent owns the selected admin-area id (`value`) and its human-readable
 * label (`label`). When a region is selected the field collapses to a compact
 * chip with "Change" / "Clear" actions; otherwise it shows a debounced search
 * input with a results dropdown.
 */
export function RegionCombobox({
  label,
  value,
  selectedLabel,
  onChange,
  placeholder = 'Search township or region...',
}: {
  readonly label: string;
  readonly value: string | null;
  /** Display name for the current `value`, if known. */
  readonly selectedLabel: string | null;
  readonly onChange: (id: string | null, displayName: string | null) => void;
  readonly placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 250);
  const containerRef = useRef<HTMLDivElement>(null);

  const showSearch = value === null || editing;
  const trimmed = debounced.trim();
  const enabled = showSearch && trimmed.length >= 1;

  const results = useQuery({
    queryKey: ['region-search', trimmed],
    queryFn: ({ signal }) => searchRegions(trimmed, 20, signal),
    enabled,
    staleTime: 30_000,
  });

  // Close the dropdown / exit editing when clicking outside.
  useEffect(() => {
    if (!showSearch) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (value !== null) setEditing(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showSearch, value]);

  const select = (option: RegionOption) => {
    onChange(option.id, option.display_name);
    setEditing(false);
    setQuery('');
  };

  const clear = () => {
    onChange(null, null);
    setEditing(true);
    setQuery('');
  };

  return (
    <div className="block" ref={containerRef}>
      <span className="mb-1 block text-xs font-semibold text-neutral-600">{label}</span>

      {value !== null && !editing ? (
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
            {selectedLabel ?? `Selected region #${value}`}
          </span>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-sky-600 hover:text-sky-700"
            onClick={() => {
              setEditing(true);
              setQuery('');
            }}
          >
            Change
          </button>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-neutral-400 hover:text-neutral-600"
            onClick={clear}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={editing}
          />

          {enabled ? (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg shadow-neutral-950/5">
              {results.isLoading ? (
                <p className="px-3 py-2 text-xs text-neutral-500">Searching…</p>
              ) : results.isError ? (
                <p className="px-3 py-2 text-xs text-red-600">Could not load regions.</p>
              ) : (results.data?.length ?? 0) === 0 ? (
                <p className="px-3 py-2 text-xs text-neutral-500">No regions found.</p>
              ) : (
                results.data?.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-neutral-50"
                    onClick={() => select(option)}
                  >
                    <span className="truncate text-sm font-medium text-neutral-900">
                      {option.display_name}
                    </span>
                    {option.name_my && option.name_my !== option.name ? (
                      <span className="truncate text-[11px] text-neutral-500">
                        {option.name_my}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {value !== null && editing ? (
            <button
              type="button"
              className="mt-1 text-xs font-semibold text-neutral-400 hover:text-neutral-600"
              onClick={() => {
                setEditing(false);
                setQuery('');
              }}
            >
              Keep current region
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
