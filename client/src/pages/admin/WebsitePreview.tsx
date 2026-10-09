import type { SiteDoc } from '@habitat/shared';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { BlockView } from '../../site/blocks';
import { SiteNavContext } from '../../site/links';
import { SiteShell } from '../../site/SiteShell';
import { usePublicConfig } from '../public/PublicLayout';

/** Full-page preview of the unpublished draft (staff only), opened from the builder. */
export function WebsitePreview() {
  const [params, setParams] = useSearchParams();
  const draft = useQuery({ queryKey: ['site-draft-preview'], queryFn: () => api.get<{ doc: SiteDoc }>('/api/admin/site/draft') });
  const { data: cfg } = usePublicConfig();
  const doc = draft.data?.doc;
  const page = doc?.pages.find((p) => p.id === params.get('page')) ?? doc?.pages[0];
  useDocumentTitle(page ? `Preview: ${page.title}` : 'Preview');
  if (draft.isError) {
    const msg = draft.error instanceof ApiError && (draft.error.status === 401 || draft.error.status === 403) ? 'Sign in to the admin to preview the website.' : 'Could not load the preview.';
    return <p style={{ padding: 24 }}>{msg}</p>;
  }
  if (!doc || !cfg || !page) return null;
  return (
    <SiteNavContext.Provider
      value={{
        editor: true,
        onNavigate: (path) => {
          const target = doc.pages.find((p) => `/${p.slug}` === path.split(/[?#]/)[0]);
          if (target) setParams({ page: target.id });
        },
      }}
    >
      <div className="wb-preview-banner" role="status">
        Preview of your unpublished changes. Visitors don't see this until you publish. <button type="button" onClick={() => void draft.refetch()}>Refresh</button>
      </div>
      <SiteShell doc={doc} cfg={cfg} currentPath={`/${page.slug}`}>
        {page.blocks.filter((b) => !b.style.hidden).map((b, i) => <BlockView key={b.id} block={b} cfg={cfg} first={i === 0} />)}
      </SiteShell>
    </SiteNavContext.Provider>
  );
}
