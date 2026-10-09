import { newBlock, siteDocSchema, type SiteDoc } from '@habitat/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { defaultSiteDoc, sniffImage } from '../src/services/site.service';
import { configureStudio, createStaff, prisma, publicClient, resetDb, staffClient } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

afterEach(() => {
  (env as { SETUP_TOKEN?: string }).SETUP_TOKEN = undefined;
});

beforeEach(async () => {
  await resetDb();
  await configureStudio();
  await createStaff('ada@studio.test', 'ADMIN');
  await createStaff('sam@studio.test', 'STAFF');
});

const draft = async (c: Awaited<ReturnType<typeof staffClient>>) => (await c.get('/api/admin/site/draft')).body as { doc: SiteDoc; revision: number; unpublishedChanges: boolean };

describe('website builder', () => {
  it('the default site (with and without built-in photos) is valid and live before anything is published', async () => {
    const s = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    for (const builtin of [true, false]) {
      const r = siteDocSchema.safeParse(defaultSiteDoc({ ...s, aboutText: 'We are a studio.\n\nMore.', homeIntro: 'Intro', featuredQuote: '“Great”' }, builtin));
      expect(r.success, JSON.stringify(!r.success && r.error.issues[0])).toBe(true);
    }
    // This install has its own custom-built site: it stays live until the builder is published.
    expect((await (await publicClient()).get('/api/public/site')).body).toEqual({ mode: 'classic' });
    // Cloud installs (with a setup token) have no original site: the starter site is live.
    (env as { SETUP_TOKEN?: string }).SETUP_TOKEN = 'setup-token-0123456789abcdef';
    const cloud = (await (await publicClient()).get('/api/public/site')).body;
    expect(cloud.mode).toBe('builder');
    expect(cloud.doc.pages[0].slug).toBe('');
    expect(JSON.stringify(cloud.doc)).not.toContain('site/hero.jpg'); // never the original studio's photos
  });

  it('draft → save (with conflict protection) → publish → live; then restore an older version', async () => {
    const ada = await staffClient('ada@studio.test');
    const d = await draft(ada);
    expect(d.unpublishedChanges).toBe(true);
    const doc = structuredClone(d.doc);
    doc.pages[0]!.blocks.unshift(newBlock('text'));
    (doc.pages[0]!.blocks[0]!.props as { text: string }).text = 'Hello **world**';
    const saved = await ada.put('/api/admin/site/draft', { revision: d.revision, doc });
    expect(saved.status).toBe(200);
    // A stale revision (someone else saved meanwhile) is refused.
    expect((await ada.put('/api/admin/site/draft', { revision: d.revision, doc })).status).toBe(409);

    expect((await ada.post('/api/admin/site/publish', { note: 'First version' })).status).toBe(200);
    const pub = (await (await publicClient()).get('/api/public/site')).body as { mode: string; doc: SiteDoc };
    expect(pub.mode).toBe('builder');
    expect(pub.doc.pages[0]!.blocks[0]!.props.text).toBe('Hello **world**');
    // The original site can be put back, and the builder published again later.
    expect((await ada.post('/api/admin/site/use-original')).body.originalSiteLive).toBe(true);
    expect((await (await publicClient()).get('/api/public/site')).body).toEqual({ mode: 'classic' });
    expect((await draft(ada)).unpublishedChanges).toBe(false);

    // Publish a second version, then bring the first back as the draft.
    const d2 = await draft(ada);
    d2.doc.pages[0]!.blocks.shift();
    await ada.put('/api/admin/site/draft', { revision: d2.revision, doc: d2.doc });
    await ada.post('/api/admin/site/publish', {});
    expect((await (await publicClient()).get('/api/public/site')).body.mode).toBe('builder');
    const versions = (await ada.get('/api/admin/site/versions')).body;
    expect(versions).toHaveLength(2);
    expect(versions[0].live).toBe(true);
    const first = versions.find((v: { note: string }) => v.note === 'First version');
    const restored = (await ada.post(`/api/admin/site/versions/${first.id}/restore`)).body;
    expect(restored.doc.pages[0].blocks[0].props.text).toBe('Hello **world**');
    expect(restored.unpublishedChanges).toBe(true);
  });

  it('publishing checks everything and names the problem; unsafe links and missing home page are refused', async () => {
    const ada = await staffClient('ada@studio.test');
    const d = await draft(ada);
    const bad = structuredClone(d.doc);
    const b = newBlock('buttons');
    (b.props as { buttons: { link: string }[] }).buttons[0]!.link = 'javascript:alert(1)';
    bad.pages[0]!.blocks.push(b);
    await ada.put('/api/admin/site/draft', { revision: d.revision, doc: bad });
    const res = await ada.post('/api/admin/site/publish', {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Home.*section \d+/);

    const d2 = await draft(ada);
    const noHome = { ...d2.doc, pages: d2.doc.pages.filter((p) => p.slug !== '') };
    await ada.put('/api/admin/site/draft', { revision: d2.revision, doc: noHome });
    expect((await ada.post('/api/admin/site/publish', {})).body.error.message).toContain('home page');

    const d3 = await draft(ada);
    const reserved = structuredClone(d3.doc);
    reserved.pages[1]!.slug = 'admin';
    await ada.put('/api/admin/site/draft', { revision: d3.revision, doc: reserved });
    expect((await ada.post('/api/admin/site/publish', {})).status).toBe(400);
  });

  it('images: only real image files, served with long caching; staff without the permission are refused', async () => {
    const ada = await staffClient('ada@studio.test');
    const up = await ada.agent.post('/api/admin/site/assets').set('Origin', 'https://book.example-studio.test').set('X-CSRF-Token', ada.csrf).set('Content-Type', 'image/png').set('X-Filename', 'logo.png').send(PNG);
    expect(up.status).toBe(201);
    expect(up.body.src).toBe(`asset:${up.body.id}`);
    const fake = await ada.agent.post('/api/admin/site/assets').set('Origin', 'https://book.example-studio.test').set('X-CSRF-Token', ada.csrf).set('Content-Type', 'image/png').send(Buffer.from('<svg onload=alert(1)>'));
    expect(fake.status).toBe(400);

    const got = await (await publicClient()).get(`/api/public/site/assets/${up.body.id}`);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['cache-control']).toContain('immutable');
    expect((await ada.get('/api/admin/site/assets')).body).toHaveLength(1);

    const sam = await staffClient('sam@studio.test');
    expect((await sam.get('/api/admin/site/draft')).status).toBe(403);
    expect((await sam.del(`/api/admin/site/assets/${up.body.id}`)).status).toBe(403);
    expect((await ada.del(`/api/admin/site/assets/${up.body.id}`)).status).toBe(204);
  });

  it('recognises image types by content', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<html>'))).toBeNull();
  });
});
