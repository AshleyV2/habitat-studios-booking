import { Link } from 'react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { Contained, usePublicConfig } from './PublicLayout';

/** Terms, refunds and privacy: text from Admin › Settings, in the site's design. */
export function PolicyPage({ kind }: { kind: 'terms' | 'refunds' | 'privacy' }) {
  const { data: cfg } = usePublicConfig();
  const title = { terms: 'Terms & Conditions', refunds: 'Refund Policy', privacy: 'Privacy Policy' }[kind];
  useDocumentTitle(cfg ? `${title} | ${cfg.businessName}` : title);
  if (!cfg) return null;
  const text = kind === 'terms' ? cfg.bookingTerms : kind === 'refunds' ? cfg.cancellationPolicy : cfg.privacyPolicy;
  return (
    <Contained>
      {text ? (
        <section className="policy" style={{ padding: '8px 0 40px' }}>
          <h1 className="sb-heading sb-heading--l">{title}</h1>
          <p className="prose">{text}</p>
        </section>
      ) : (
        <div className="pub-notice">
          This page hasn't been written yet. <Link to="/">Back to the home page</Link>
        </div>
      )}
    </Contained>
  );
}
