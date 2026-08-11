import { useEffect, useId, useRef, useState } from 'react';
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
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
  const options = results.data ?? [];

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
    setActiveIndex(-1);
  };

  const clear = () => {
    onChange(null, null);
    setEditing(true);
    setQuery('');
    setActiveIndex(-1);
  };

  return (
    <div className="block" ref={containerRef}>
      <span className="mb-1 block text-xs font-semibold text-map-muted">{label}</span>

      {value !== null && !editing ? (
        <div className="flex items-center gap-2 rounded-map-control border border-map-border bg-map-surface px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-map-ink">
            {selectedLabel ?? `Selected region #${value}`}
          </span>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-map-primary hover:text-map-primary-hover"
            onClick={() => {
              setEditing(true);
              setQuery('');
            }}
          >
            Change
          </button>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-map-muted/75 hover:text-map-primary"
            onClick={clear}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none transition-colors focus:border-map-primary "
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, options.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && activeIndex >= 0 && options[activeIndex]) {
                event.preventDefault();
                select(options[activeIndex]);
              } else if (event.key === 'Escape') {
                setActiveIndex(-1);
                if (value !== null) setEditing(false);
              }
            }}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-controls={enabled ? listboxId : undefined}
            aria-expanded={enabled}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
            autoFocus={editing}
          />

          {enabled ? (
            <div
              id={listboxId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-map-card border border-map-border bg-map-surface py-1 shadow-map-float"
            >
              {results.isLoading ? (
                <p className="px-3 py-2 text-xs text-map-muted">Searching…</p>
              ) : results.isError ? (
                <p className="px-3 py-2 text-xs text-red-600">Could not load regions.</p>
              ) : (results.data?.length ?? 0) === 0 ? (
                <p className="px-3 py-2 text-xs text-map-muted">No regions found.</p>
              ) : (
                options.map((option, index) => (
                  <button
                    key={option.id}
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`map-focus-inset flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                      index === activeIndex ? 'bg-map-primary-soft' : 'hover:bg-map-primary-soft'
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(option)}
                  >
                    <span className="truncate text-sm font-medium text-map-ink">
                      {option.display_name}
                    </span>
                    {option.name_my && option.name_my !== option.name ? (
                      <span className="truncate text-xs text-map-muted">
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
              className="mt-1 text-xs font-semibold text-map-muted/75 hover:text-map-primary"
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
