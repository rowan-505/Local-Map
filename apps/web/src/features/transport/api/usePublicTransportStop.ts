import { useQuery } from '@tanstack/react-query';
import type { LanguageMode } from '@local-map/localized-name';
import { ApiError } from '@/features/auth/api/http';
import { getTransportStopDetail } from './publicTransportApi';

function transportDetailLang(
  languageMode: LanguageMode,
): 'my' | 'en' | 'und' | undefined {
  if (languageMode === 'my' || languageMode === 'en') {
    return languageMode;
  }
  return undefined;
}

/**
 * Public transport stop detail query — mirrors `usePublicPlace` for detail panels.
 *
 * Pass `stopId` as numeric tile id (preferred) or uuid `public_id`. When `stopId` is
 * null the query stays disabled.
 */
export function usePublicTransportStop(
  stopId: string | null,
  languageMode: LanguageMode = 'my',
) {
  const lang = transportDetailLang(languageMode);

  return useQuery({
    queryKey: ['public-transport-stop', stopId, lang ?? 'default'],
    queryFn: ({ signal }) =>
      getTransportStopDetail(stopId ?? '', {
        ...(lang ? { lang } : {}),
        signal,
      }),
    enabled: stopId !== null && stopId.trim() !== '',
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
