import { useQuery } from '@tanstack/react-query';
import { fetchPublicTransportStopRoutes } from './publicTransportApi';

/** Routes serving a public transport stop (uuid public_id). Disabled when id is absent. */
export function usePublicTransportStopRoutes(publicId: string | null, limit = 25) {
  return useQuery({
    queryKey: ['public-transport-stop-routes', publicId, limit],
    queryFn: ({ signal }) => fetchPublicTransportStopRoutes(publicId ?? '', signal, limit),
    enabled: publicId !== null && publicId.trim() !== '',
  });
}
