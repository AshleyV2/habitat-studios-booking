import type { PublicConfig, SiteDoc } from '@habitat/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export const usePublicConfig = () =>
  useQuery({ queryKey: ['public-config'], queryFn: () => api.get<PublicConfig>('/api/public/config'), staleTime: 60_000 });

/** Which website is live: the studio's original custom-built one, or the website builder's. */
export type PublicSite = { mode: 'classic' } | { mode: 'builder'; doc: SiteDoc };
export const usePublicSite = () => useQuery({ queryKey: ['public-site'], queryFn: () => api.get<PublicSite>('/api/public/site'), staleTime: 60_000 });
