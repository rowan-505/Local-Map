import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { createShareLink, type CreateShareLinkPayload } from '../api/shareApi';

/** What the card shares. Detail fields feed the "Copy address/details" output. */
export type ShareCardTarget =
  | {
      readonly kind: 'point';
      readonly lat: number;
      readonly lng: number;
      readonly zoom?: number;
      readonly addressLine?: string | null;
      readonly plusCode?: string | null;
    }
  | {
      readonly kind: 'place';
      readonly placePublicId: string;
      readonly name?: string | null;
      readonly addressLine?: string | null;
      readonly plusCode?: string | null;
    };

/**
 * Minimal CoreMap-only share card. On open (and whenever the target changes) it
 * creates a short share link via React Query, then exposes "Copy link" (short
 * URL only) and "Copy address/details". No external map links, QR, analytics,
 * or expiry.
 */
export function ShareCard({ target }: { readonly target: ShareCardTarget }) {
  const t = useMapUiText();
  // Stable key over the meaningful fields (the target object is rebuilt each render).
  const identity =
    target.kind === 'place'
      ? `place:${target.placePublicId}`
      : `point:${target.lat},${target.lng},${target.zoom ?? ''}`;

  // The share link is created once per target via React Query: the result is
  // cached by `identity`, so re-renders never re-POST, and changing the
  // point/place resets it (new key → new request). `staleTime: Infinity` keeps
  // a reopened card from refetching; `retry: false` keeps it to a single POST.
  const { data, isPending, isError } = useQuery({
    queryKey: ['share-link', identity],
    queryFn: () => createShareLink(toPayload(target)),
    staleTime: Infinity,
    retry: false,
  });

  const url = data?.url ?? null;
  const title =
    target.kind === 'point'
      ? t('တည်နေရာမျှဝေရန်', 'Share location')
      : t('နေရာမျှဝေရန်', 'Share place');
  const detailsText = buildDetailsText(target, url);

  return (
    <section
      className="rounded-map-card border border-map-border bg-map-surface p-3.5 shadow-map-card"
      aria-label={title}
    >
      <h3 className="map-kicker mb-2 text-map-primary">
        {title}
      </h3>
      <p className="text-xs font-medium text-map-muted">
        {t('CoreMap လင့်ခ်အတို', 'CoreMap short link')}
      </p>
      <p className="mt-1 break-all font-mono text-sm leading-5 text-map-ink" aria-live="polite">
        {isPending ? t('လင့်ခ် ဖန်တီးနေသည်…', 'Creating link…') : (url ?? '—')}
      </p>
      {isError ? (
        <p className="mt-1 text-xs text-red-600">
          {t('လင့်ခ် ဖန်တီး၍မရပါ။', 'Could not create link.')}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <CopyButton label={t('လင့်ခ်ကူးယူရန်', 'Copy link')} value={url} disabled={isPending || !url} />
        <CopyButton
          label={t('လိပ်စာ/အသေးစိတ် ကူးယူရန်', 'Copy address/details')}
          value={detailsText}
          disabled={detailsText.length === 0}
        />
      </div>
    </section>
  );
}

function CopyButton({
  label,
  value,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly disabled?: boolean;
}) {
  const t = useMapUiText();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onClick = () => {
    if (!value) return;
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-map-control border border-map-border bg-map-surface px-2 py-2 text-xs font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary disabled:cursor-not-allowed disabled:opacity-45"
    >
      {copied ? t('ကူးယူပြီး', 'Copied') : label}
    </button>
  );
}

function toPayload(target: ShareCardTarget): CreateShareLinkPayload {
  if (target.kind === 'place') {
    return { target_type: 'place', place_public_id: target.placePublicId };
  }

  return {
    target_type: 'point',
    lat: target.lat,
    lng: target.lng,
    ...(target.zoom !== undefined ? { zoom: target.zoom } : {}),
    ...(target.addressLine ? { address_line: target.addressLine } : {}),
    ...(target.plusCode ? { plus_code: target.plusCode } : {}),
  };
}

function buildDetailsText(target: ShareCardTarget, url: string | null): string {
  const lines: string[] = [];

  if (target.kind === 'place') {
    if (target.name?.trim()) lines.push(target.name.trim());
    if (target.addressLine?.trim()) lines.push(target.addressLine.trim());
    if (target.plusCode?.trim()) lines.push(`Plus Code: ${target.plusCode.trim()}`);
  } else {
    // Point: fall back to coordinates when there is no address line.
    lines.push(target.addressLine?.trim() || formatCoordinates(target.lat, target.lng));
    if (target.plusCode?.trim()) lines.push(`Plus Code: ${target.plusCode.trim()}`);
  }

  if (url) lines.push(url);

  return lines.join('\n');
}

function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
