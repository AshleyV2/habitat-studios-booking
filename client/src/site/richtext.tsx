import { siteLinkSchema } from '@habitat/shared';
import { Fragment, type ReactNode } from 'react';
import { SiteLink } from './links';

/*
 * Website text: plain text with a small, safe markup, rendered as React elements (never as
 * HTML, so nothing typed can inject markup or scripts).
 *
 *   **bold**   *italic*   [link text](/page or https://…)
 *   - bullet list        1. numbered list
 *   ## Subheading        > quote
 *   A blank line starts a new paragraph; a single line break stays a line break.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<strong key={key}>{inline(m[1], key)}</strong>);
    else if (m[2] !== undefined) out.push(<em key={key}>{inline(m[2], key)}</em>);
    else {
      const ok = siteLinkSchema.safeParse(m[4]).success;
      out.push(ok ? <SiteLink key={key} to={m[4]!}>{m[3]}</SiteLink> : m[3]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[], keyBase: string): ReactNode[] {
  return lines.flatMap((l, i) => (i === 0 ? inline(l, `${keyBase}-${i}`) : [<br key={`${keyBase}-br${i}`} />, ...inline(l, `${keyBase}-${i}`)]));
}

export function RichText({ text, className }: { text: string; className?: string }) {
  if (!text?.trim()) return null;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  return (
    <div className={`sb-rich${className ? ` ${className}` : ''}`}>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l, j, all) => l.trim() !== '' || (j > 0 && j < all.length - 1));
        const key = `b${i}`;
        if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return <ul key={key}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''), `${key}-${j}`)}</li>)}</ul>;
        }
        if (lines.length && lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return <ol key={key}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''), `${key}-${j}`)}</li>)}</ol>;
        }
        if (lines.length === 1 && /^#{2,3}\s+/.test(lines[0]!)) return <h3 key={key}>{inline(lines[0]!.replace(/^#{2,3}\s+/, ''), key)}</h3>;
        if (lines.length && lines.every((l) => /^>\s?/.test(l))) return <blockquote key={key}>{withBreaks(lines.map((l) => l.replace(/^>\s?/, '')), key)}</blockquote>;
        return <p key={key}>{withBreaks(lines, key)}</p>;
      })}
    </div>
  );
}

/** One line of text with inline formatting only (headings, labels). */
export function InlineText({ text }: { text: string }) {
  return <Fragment>{inline(text ?? '', 'i')}</Fragment>;
}
