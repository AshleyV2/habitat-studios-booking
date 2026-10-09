import type { Request, Response } from 'express';
import { z } from 'zod';
import * as site from '../services/site.service';
import { unauthorized } from '../utils/errors';
import { parse } from '../utils/validate';

const actor = (req: Request) => {
  if (!req.auth) throw unauthorized();
  return [req.auth.user.id, req.ip ?? null] as const;
};
const idParam = z.object({ id: z.string().min(1).max(64) });
const saveBody = z.object({ revision: z.number().int().min(1), doc: z.unknown() });
const publishBody = z.object({ note: z.string().trim().max(200).optional() });

/** Website builder (admin) and the live site (public). */
export const siteController = {
  // --- Public -------------------------------------------------------------------
  async published(_req: Request, res: Response) {
    res.json(await site.getPublicSite());
  },

  /** Uploaded images. Ids are random and content never changes, so cache for a year. */
  async asset(req: Request, res: Response) {
    const a = await site.getAssetData(String(req.params.id ?? ''));
    if (!a) return void res.status(404).end();
    res.set({ 'Content-Type': a.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'same-origin' });
    res.send(Buffer.from(a.data));
  },

  // --- Admin ----------------------------------------------------------------------
  draft: async (_req: Request, res: Response) => res.json(await site.getDraft()),
  save: async (req: Request, res: Response) => {
    const { doc, revision } = parse(saveBody, req.body);
    res.json(await site.saveDraft(doc, revision, actor(req)[0]));
  },
  publish: async (req: Request, res: Response) => res.json(await site.publishDraft(parse(publishBody, req.body).note ?? null, ...actor(req))),
  discard: async (req: Request, res: Response) => res.json(await site.discardDraft(...actor(req))),
  useOriginal: async (req: Request, res: Response) => res.json(await site.useOriginalSite(...actor(req))),
  reset: async (req: Request, res: Response) => res.json(await site.resetDraftToDefault(...actor(req))),
  versions: async (_req: Request, res: Response) => res.json(await site.listVersions()),
  restore: async (req: Request, res: Response) => res.json(await site.restoreVersion(parse(idParam, req.params).id, ...actor(req))),
  assets: async (_req: Request, res: Response) => res.json(await site.listAssets()),
  upload: async (req: Request, res: Response) => {
    const name = String(req.get('x-filename') ?? 'image');
    res.status(201).json(await site.uploadAsset(req.body, decodeURIComponent(name).slice(0, 200), ...actor(req)));
  },
  deleteAsset: async (req: Request, res: Response) => {
    await site.deleteAsset(parse(idParam, req.params).id, ...actor(req));
    res.status(204).end();
  },
};
