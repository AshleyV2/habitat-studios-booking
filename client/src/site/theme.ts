import { contrastRatio, SITE_FONTS, type SiteTheme } from '@habitat/shared';
import type { CSSProperties } from 'react';

const RADIUS = { none: '0px', s: '4px', m: '10px', l: '18px' } as const;
const BUTTON_RADIUS = { square: 'var(--sb-radius)', rounded: '8px', pill: '999px' } as const;
const TEXT_SIZE = { s: '15px', m: '16px', l: '18px' } as const;
const MAX_WIDTH = { narrow: '960px', normal: '1120px', wide: '1320px' } as const;

/**
 * The theme as CSS custom properties on the site root. Both the website blocks (sb-*) and
 * the booking pages' existing variables (--ink, --paper, --signal…) are set, so the booking
 * system keeps its layout but takes the studio's colours and fonts.
 */
export function themeStyle(t: SiteTheme): CSSProperties {
  const c = t.colors;
  // On dark sections the main button must still stand out: use the main colour if it
  // contrasts with the dark background, otherwise a light button.
  const primaryOnDark = contrastRatio(c.primary, c.dark) >= 3;
  return {
    '--sb-btn-dark-bg': primaryOnDark ? c.primary : c.onDark,
    '--sb-btn-dark-text': primaryOnDark ? c.onPrimary : c.dark,
    '--sb-primary': c.primary,
    '--sb-on-primary': c.onPrimary,
    '--sb-accent': c.accent,
    '--sb-bg': c.background,
    '--sb-surface': c.surface,
    '--sb-text': c.text,
    '--sb-muted': c.muted,
    '--sb-border': c.border,
    '--sb-dark': c.dark,
    '--sb-on-dark': c.onDark,
    '--sb-header-bg': c.headerBg,
    '--sb-header-text': c.headerText,
    '--sb-footer-bg': c.footerBg,
    '--sb-footer-text': c.footerText,
    '--sb-heading-font': SITE_FONTS[t.headingFont]?.stack ?? SITE_FONTS.archivo.stack,
    '--sb-body-font': SITE_FONTS[t.bodyFont]?.stack ?? SITE_FONTS.plex.stack,
    '--sb-heading-case': t.headingCase === 'upper' ? 'uppercase' : 'none',
    '--sb-radius': RADIUS[t.radius] ?? RADIUS.s,
    '--sb-btn-radius': BUTTON_RADIUS[t.buttonShape] ?? BUTTON_RADIUS.square,
    '--sb-max': MAX_WIDTH[t.maxWidth] ?? MAX_WIDTH.normal,
    '--sb-size': TEXT_SIZE[t.textSize] ?? TEXT_SIZE.m,
    // The booking pages' palette
    '--ink': c.text,
    '--paper': c.background,
    '--card': c.surface,
    '--line': c.border,
    '--line-strong': c.muted,
    '--muted': c.muted,
    '--signal': c.primary,
    '--signal-dark': c.primary,
  } as CSSProperties;
}

export const themeClass = (t: SiteTheme) => `site sb-theme sb-btn--${t.buttonStyle}`;
