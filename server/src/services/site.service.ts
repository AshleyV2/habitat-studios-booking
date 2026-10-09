import {
  newBlock,
  newId,
  siteDocSchema,
  THEME_PRESETS,
  type BlockType,
  type SiteBlock,
  type SiteDoc,
  type SiteImage,
  type SitePage,
} from '@habitat/shared';
import type { Prisma, Settings } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';
import { audit } from './audit.service';
import { getSettings } from './settings.service';

/*
 * The website builder. One draft document that staff edit (saved as they go) and a list
 * of published versions; the newest version is the live site. Drafts are saved as-is so
 * half-finished edits never get lost; publishing validates the whole site strictly.
 */

const KEEP_VERSIONS = 30;
const MAX_DOC_BYTES = 900_000;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_ASSETS = 500;

/**
 * The photos shipped with the app belong to the original studio. Cloud instances (which have
 * a SETUP_TOKEN) never offer or use them; their default site starts without photos.
 */
export const builtinImagesAllowed = () => !env.SETUP_TOKEN;

// ---------------------------------------------------------------------------
// Default site, built from what the studio already has in Settings
// ---------------------------------------------------------------------------

function block(type: BlockType, props: Record<string, unknown> = {}, style: Partial<SiteBlock['style']> = {}): SiteBlock {
  const b = newBlock(type);
  return { ...b, props: { ...b.props, ...props }, style: { ...b.style, ...style } };
}

const img = (src: string, alt = ''): SiteImage => ({ src, alt });
const firstParagraph = (t: string) => t.split(/\n\s*\n/)[0] ?? t;

export function defaultSiteDoc(s: Settings, builtin = builtinImagesAllowed()): SiteDoc {
  const theme = structuredClone(THEME_PRESETS.mono!.theme);
  const home: SitePage = {
    id: newId(),
    slug: '',
    title: 'Home',
    navLabel: 'Home',
    showInNav: true,
    seoTitle: '',
    seoDescription: s.tagline ?? '',
    blocks: [
      block(
        'hero',
        { heading: s.homeHeadline ?? `Welcome to ${s.businessName}`, text: s.tagline ?? '' },
        builtin ? { background: 'image', backgroundImage: img('site/hero.jpg'), overlay: 55 } : { background: 'dark' },
      ),
      ...(s.homeIntro ? [block('imageText', { heading: 'The place to rehearse', text: s.homeIntro, image: null, buttons: [{ label: 'Book now', link: '/book', style: 'primary' }] })] : []),
      ...(s.aboutText
        ? [
            block(
              'imageText',
              {
                eyebrow: 'Get to know us',
                heading: 'Our story',
                text: firstParagraph(s.aboutText),
                image: builtin ? img('site/story.jpg', `Inside ${s.businessName}`) : null,
                buttons: [{ label: 'Read more', link: '/about', style: 'secondary' }],
              },
              { background: 'dark', width: 'wide' },
            ),
          ]
        : []),
      block('rooms', { heading: 'Our rooms' }),
      block('equipment', { heading: 'Equipment hire' }),
      ...(builtin
        ? [
            block('logos', {
              heading: 'Our clients',
              items: [
                ['client-happy-mondays', 'Happy Mondays'],
                ['client-badly-drawn-boy', 'Badly Drawn Boy'],
                ['client-airbourne', 'Airbourne'],
                ['client-nm', 'Client logo'],
                ['client-fs', 'Client logo'],
                ['client-ab', 'Client logo'],
              ].map(([f, alt]) => ({ image: img(`site/${f}.jpg`, alt), link: '' })),
            }),
          ]
        : []),
      ...(s.featuredQuote
        ? [block('testimonials', { heading: '', items: [{ quote: s.featuredQuote.replace(/^[“"]|[”"]$/g, ''), author: s.featuredQuoteAuthor ?? '', role: '' }] }, { background: 'dark', align: 'center' })]
        : []),
      ...(builtin
        ? [block('gallery', { heading: 'Gallery', layout: 'strip', columns: 4, images: [1, 2, 3, 4].map((n) => ({ image: img(`site/gallery-${n}.jpg`), caption: '' })) })]
        : []),
      block('cta', { heading: 'Ready to play?' }),
    ],
  };
  const about: SitePage = {
    id: newId(),
    slug: 'about',
    title: 'About',
    navLabel: 'About',
    showInNav: true,
    seoTitle: '',
    seoDescription: '',
    blocks: [
      block('heading', { eyebrow: 'About', heading: 'Our story', size: 'xl' }, { background: 'dark', padding: 'l' }),
      block('imageText', { heading: '', text: s.aboutText ?? 'Tell visitors about your studio: who you are, what makes your rooms special.', image: builtin ? img('site/about.jpg', s.businessName) : null, buttons: [{ label: 'Book a room', link: '/book', style: 'primary' }] }),
    ],
  };
  const rooms: SitePage = {
    id: newId(),
    slug: 'rooms',
    title: 'Our rooms',
    navLabel: 'Our rooms',
    showInNav: true,
    seoTitle: '',
    seoDescription: '',
    blocks: [
      block('heading', { eyebrow: 'Our spaces', heading: 'Our rooms', size: 'xl', text: s.roomsIntro ?? '' }, { background: 'dark', padding: 'l' }),
      ...(s.communalText ? [block('imageText', { heading: 'Communal area', text: s.communalText, image: builtin ? img('site/communal.jpg') : null, imageSide: 'right' })] : []),
      block('rooms', { heading: '', layout: 'detailed' }),
      block('equipment', { heading: 'Equipment hire' }),
    ],
  };
  const gallery: SitePage = {
    id: newId(),
    slug: 'gallery',
    title: 'Gallery',
    navLabel: 'Gallery',
    showInNav: true,
    seoTitle: '',
    seoDescription: '',
    blocks: [
      block('heading', { heading: 'Gallery', size: 'xl' }, { background: 'dark', padding: 'l' }),
      block('gallery', { heading: '', columns: 3, images: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ image: img(`site/gallery-${n}.jpg`), caption: '' })) }),
    ],
  };
  const contact: SitePage = {
    id: newId(),
    slug: 'contact',
    title: 'Contact',
    navLabel: 'Contact',
    showInNav: true,
    seoTitle: '',
    seoDescription: '',
    blocks: [block('contact', { heading: 'Find us' }), block('map', {})],
  };
  return {
    v: 1,
    theme,
    header: { logo: null, logoHeight: 40, showName: true, layout: 'left', sticky: false, showBookButton: true, bookLabel: 'Book now', extraLinks: [], announcement: s.announcement ?? '', announcementLink: '' },
    footer: { text: '', showContact: true, showHours: true, showLinks: true, showSocial: true },
    social: { instagram: httpsOrEmpty(s.instagramUrl), facebook: httpsOrEmpty(s.facebookUrl), tiktok: '', youtube: '', x: '' },
    pages: builtin ? [home, about, rooms, gallery, contact] : [home, about, rooms, contact],
  };
}

const httpsOrEmpty = (u: string | null) => (u && /^https:\/\/[^\s<>"']+$/i.test(u) ? u : '');

// ---------------------------------------------------------------------------
// Published site
// ---------------------------------------------------------------------------

async function latestVersion() {
  return prisma.siteVersion.findFirst({ orderBy: { publishedAt: 'desc' } });
}

/**
 * What visitors see. The original studio's install has its own custom-built site, which stays
 * live ("classic") until the builder is published, and can be switched back to. Every other
 * install (cloud customers) always uses the builder: the newest published version, or the
 * starter site built from Settings.
 */
export async function getPublicSite(): Promise<{ mode: 'classic' } | { mode: 'builder'; doc: SiteDoc }> {
  const [v, d] = await Promise.all([latestVersion(), prisma.siteDraft.findUnique({ where: { id: 1 }, select: { builderLive: true } })]);
  if (builtinImagesAllowed() && !(v && d?.builderLive)) return { mode: 'classic' };
  return { mode: 'builder', doc: v ? (v.doc as unknown as SiteDoc) : defaultSiteDoc(await getSettings()) };
}

async function getPublishedSite(): Promise<SiteDoc> {
  const v = await latestVersion();
  if (v) return v.doc as unknown as SiteDoc;
  return defaultSiteDoc(await getSettings());
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

async function ensureDraft() {
  const d = await prisma.siteDraft.findUnique({ where: { id: 1 } });
  if (d) return d;
  const doc = await getPublishedSite();
  return prisma.siteDraft.upsert({ where: { id: 1 }, create: { id: 1, doc: doc as unknown as Prisma.InputJsonValue }, update: {} });
}

export async function getDraft() {
  const [d, v] = await Promise.all([ensureDraft(), latestVersion()]);
  return {
    doc: d.doc as unknown as SiteDoc,
    revision: d.revision,
    updatedAt: d.updatedAt.toISOString(),
    publishedAt: v?.publishedAt.toISOString() ?? null,
    /** True when the draft differs from what is live. */
    unpublishedChanges: !v || JSON.stringify(v.doc) !== JSON.stringify(d.doc),
    builtinImages: builtinImagesAllowed(),
    /** This install has its own original site; true while that (not the builder) is live. */
    originalSiteLive: builtinImagesAllowed() && !(v && d.builderLive),
    hasOriginalSite: builtinImagesAllowed(),
  };
}

/** Save the working copy. `revision` must match, so concurrent editors can't overwrite each other. */
export async function saveDraft(doc: unknown, revision: number, actorId: string) {
  if (!doc || typeof doc !== 'object' || (doc as { v?: unknown }).v !== 1 || !Array.isArray((doc as { pages?: unknown }).pages)) {
    throw badRequest('Not a website document.');
  }
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) throw badRequest('The website is too large to save. Remove some sections or pages.');
  await ensureDraft();
  const { count } = await prisma.siteDraft.updateMany({
    where: { id: 1, revision },
    data: { doc: doc as Prisma.InputJsonValue, revision: { increment: 1 }, updatedById: actorId },
  });
  if (count === 0) throw new AppError(409, 'draft_changed', 'Someone else changed the website while you were editing. Reload to see their changes.');
  return getDraft();
}

/** Turn validation issues into one readable sentence naming the page and section. */
function describeIssue(doc: SiteDoc, issue: { path: PropertyKey[]; message: string }) {
  const [root, pageIdx, , blockIdx] = issue.path;
  if (root === 'pages' && typeof pageIdx === 'number') {
    const page = doc.pages?.[pageIdx];
    const where = page ? `“${page.title || '/' + page.slug}”` : `page ${pageIdx + 1}`;
    if (typeof blockIdx === 'number') return `On ${where}, section ${blockIdx + 1}: ${issue.message}`;
    return `On ${where}: ${issue.message}`;
  }
  return `${String(root ?? 'Site')}: ${issue.message}`;
}

export async function publishDraft(note: string | null, actorId: string, ip: string | null) {
  const d = await ensureDraft();
  const parsed = siteDocSchema.safeParse(d.doc);
  if (!parsed.success) {
    throw badRequest(`Can't publish yet. ${describeIssue(d.doc as unknown as SiteDoc, parsed.error.issues[0]!)}`);
  }
  const v = await prisma.$transaction(async (tx) => {
    const created = await tx.siteVersion.create({ data: { doc: parsed.data as unknown as Prisma.InputJsonValue, note: note || null, publishedById: actorId } });
    // The draft becomes exactly what was published (validation fills in defaults).
    await tx.siteDraft.update({ where: { id: 1 }, data: { doc: parsed.data as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, builderLive: true } });
    const old = await tx.siteVersion.findMany({ orderBy: { publishedAt: 'desc' }, skip: KEEP_VERSIONS, select: { id: true } });
    if (old.length) await tx.siteVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    return created;
  });
  await audit({ action: 'website.published', actorId, targetType: 'site_version', targetId: v.id, metadata: { note, pages: parsed.data.pages.length }, ipAddress: ip });
  return getDraft();
}

export async function listVersions() {
  const versions = await prisma.siteVersion.findMany({ orderBy: { publishedAt: 'desc' }, select: { id: true, note: true, publishedAt: true, publishedById: true } });
  const ids = [...new Set(versions.map((v) => v.publishedById).filter((x): x is string => Boolean(x)))];
  const people = new Map((await prisma.staffUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return versions.map((v, i) => ({ id: v.id, note: v.note, publishedAt: v.publishedAt.toISOString(), publishedBy: v.publishedById ? people.get(v.publishedById) ?? null : null, live: i === 0 }));
}

/** Copy a published version into the draft (it goes live only when published again). */
export async function restoreVersion(id: string, actorId: string, ip: string | null) {
  const v = await prisma.siteVersion.findUnique({ where: { id } });
  if (!v) throw notFound('That version no longer exists.');
  await ensureDraft();
  await prisma.siteDraft.update({ where: { id: 1 }, data: { doc: v.doc as Prisma.InputJsonValue, revision: { increment: 1 }, updatedById: actorId } });
  await audit({ action: 'website.version_restored', actorId, targetType: 'site_version', targetId: id, ipAddress: ip });
  return getDraft();
}

/** Put the original custom-built site back live (installs that have one). Builder work is kept. */
export async function useOriginalSite(actorId: string, ip: string | null) {
  if (!builtinImagesAllowed()) throw badRequest('This website has no original design to go back to.');
  await ensureDraft();
  await prisma.siteDraft.update({ where: { id: 1 }, data: { builderLive: false } });
  await audit({ action: 'website.original_restored', actorId, ipAddress: ip });
  return getDraft();
}

/** Throw away unpublished changes. */
export async function discardDraft(actorId: string, ip: string | null) {
  const v = await latestVersion();
  const doc = v ? v.doc : (defaultSiteDoc(await getSettings()) as unknown as Prisma.InputJsonValue);
  await ensureDraft();
  await prisma.siteDraft.update({ where: { id: 1 }, data: { doc: doc as Prisma.InputJsonValue, revision: { increment: 1 }, updatedById: actorId } });
  await audit({ action: 'website.draft_discarded', actorId, ipAddress: ip });
  return getDraft();
}

/** Start again from the default site built from Settings (as a draft). */
export async function resetDraftToDefault(actorId: string, ip: string | null) {
  await ensureDraft();
  const doc = defaultSiteDoc(await getSettings());
  await prisma.siteDraft.update({ where: { id: 1 }, data: { doc: doc as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, updatedById: actorId } });
  await audit({ action: 'website.draft_reset', actorId, ipAddress: ip });
  return getDraft();
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Identify the image type from its first bytes; the declared type is never trusted. */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export async function uploadAsset(body: unknown, filename: string, actorId: string, ip: string | null) {
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Choose an image to upload.');
  if (body.length > MAX_ASSET_BYTES) throw badRequest('Images can be up to 5 MB. Save it smaller and try again.');
  const mime = sniffImage(body);
  if (!mime) throw badRequest('Only JPEG, PNG, WebP and GIF images can be uploaded.');
  if ((await prisma.siteAsset.count()) >= MAX_ASSETS) throw conflict('The image library is full (500 images). Delete some you no longer use.');
  const clean = filename.replace(/[^\w.\- ]+/g, '').trim().slice(0, 120) || 'image';
  const a = await prisma.siteAsset.create({ data: { filename: clean, mime, size: body.length, data: new Uint8Array(body), uploadedById: actorId }, select: { id: true, filename: true, mime: true, size: true, createdAt: true } });
  await audit({ action: 'website.image_uploaded', actorId, targetType: 'site_asset', targetId: a.id, metadata: { filename: clean, size: body.length }, ipAddress: ip });
  return { ...a, src: `asset:${a.id}`, createdAt: a.createdAt.toISOString() };
}

export async function listAssets() {
  const rows = await prisma.siteAsset.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, filename: true, mime: true, size: true, createdAt: true } });
  return rows.map((a) => ({ ...a, src: `asset:${a.id}`, createdAt: a.createdAt.toISOString() }));
}

export async function deleteAsset(id: string, actorId: string, ip: string | null) {
  const a = await prisma.siteAsset.findUnique({ where: { id }, select: { id: true, filename: true } });
  if (!a) throw notFound('Image not found.');
  await prisma.siteAsset.delete({ where: { id } });
  await audit({ action: 'website.image_deleted', actorId, targetType: 'site_asset', targetId: id, metadata: { filename: a.filename }, ipAddress: ip });
}

export async function getAssetData(id: string) {
  if (!/^[a-z0-9]{10,40}$/.test(id)) return null;
  return prisma.siteAsset.findUnique({ where: { id }, select: { data: true, mime: true } });
}
