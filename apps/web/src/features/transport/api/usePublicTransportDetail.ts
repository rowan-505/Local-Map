import { useQuery } from '@tanstack/react-query';
import type { LanguageMode } from '@local-map/localized-name';
import { ApiError } from '@/features/auth/api/http';
import type { TransportMapSelection } from '@/features/transport/transportMapSelection';
import {
  getTransportStopDetail,
  getTransportTerminalDetail,
} from './publicTransportApi';

function transportDetailLang(
  languageMode: LanguageMode,
): 'my' | 'en' | 'und' | undefined {
  if (languageMode === 'my' || languageMode === 'en') {
    return languageMode;
  }
  return undefined;
}

/**
 * Public transport stop or terminal detail query for map selection panels.
 */
export function usePublicTransportDetail(
  selection: TransportMapSelection | null,
  languageMode: LanguageMode = 'my',
) {
  const apiLookupId = selection?.apiLookupId ?? null;
  const kind = selection?.kind ?? 'stop';
  const lang = transportDetailLang(languageMode);

  return useQuery({
    queryKey: ['public-transport-detail', kind, apiLookupId, lang ?? 'default'],
    queryFn: ({ signal }) => {
      const options = {
        ...(lang ? { lang } : {}),
        signal,
      };
      if (kind === 'terminal') {
        return getTransportTerminalDetail(apiLookupId ?? '', options);
      }
      return getTransportStopDetail(apiLookupId ?? '', options);
    },
    enabled: apiLookupId !== null && apiLookupId.trim() !== '',
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
