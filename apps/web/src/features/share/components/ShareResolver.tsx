import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPublicPlace } from '@/features/poi/api/publicMapApi';
import { resolveShareLink } from '../api/shareApi';
import { SHARE_NAV_STATE_KEY, type ShareNavTarget } from '../shareNavigation';

/**
 * Resolves a CoreMap short link (/s/:code) then hands the target to HomePage via
 * router state and redirects to "/". For place links it also fetches the place
 * coordinates so HomePage can center immediately. No external map links, no auth.
 */
export default function ShareResolver() {
  const { code } = useParams();
  const navigate = useNavigate();

  const { data, isError } = useQuery({
    queryKey: ['share-resolve', code],
    enabled: Boolean(code),
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<ShareNavTarget> => {
      const resolved = await resolveShareLink(code as string);

      if (resolved.target_type === 'place') {
        const place = await fetchPublicPlace(resolved.place_public_id);
        return {
          kind: 'place',
          placePublicId: resolved.place_public_id,
          lat: place.latitude,
          lng: place.longitude,
          name: place.name ?? null,
          addressLine: place.addressLine ?? null,
          plusCode: place.plusCode ?? null,
        };
      }

      return {
        kind: 'point',
        lat: resolved.lat,
        lng: resolved.lng,
        zoom: resolved.zoom,
        addressLine: resolved.address_line,
        plusCode: resolved.plus_code,
      };
    },
  });

  useEffect(() => {
    if (data) {
      navigate('/', { replace: true, state: { [SHARE_NAV_STATE_KEY]: data } });
    }
  }, [data, navigate]);

  const notFound = isError || !code;

  return (
    <div className="flex flex-1 items-center justify-center bg-neutral-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        {notFound ? (
          <>
            <h1 className="text-base font-semibold text-neutral-950">Shared link not found.</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              This share link is invalid or no longer available.
            </p>
            <Link
              to="/"
              className="mt-4 inline-block rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
            >
              Open the map
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold text-neutral-950">Opening shared location…</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">Resolving your CoreMap link.</p>
          </>
        )}
      </div>
    </div>
  );
}
