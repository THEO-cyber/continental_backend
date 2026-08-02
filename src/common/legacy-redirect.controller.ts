import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppConfig } from '../config/app.config';
import { Public } from './decorators';

/**
 * The public site used to be rendered by this backend directly (see git
 * history: src/render/*, removed once continental_client moved to its own
 * Netlify-hosted site). Anyone hitting one of those old paths — a stale
 * bookmark, an indexed Google result, an old QR code — gets a permanent
 * redirect to the same path on the new site instead of a dead 404, so
 * whatever SEO value those URLs accumulated carries forward.
 *
 * Explicit path list, not a wildcard: this must never be able to shadow
 * /api/* or /socket.io/*, which are the entire reason this backend still
 * exists.
 */
@Public()
@Controller()
export class LegacyRedirectController {
  constructor(private readonly config: AppConfig) {}

  @Get([
    '/',
    '/en', '/fr', '/zh',
    '/en/product/*splat', '/fr/product/*splat', '/zh/product/*splat',
    '/sitemap.xml', '/robots.txt',
    '/manifest.webmanifest', '/sw.js', '/offline.html',
    '/assets/*splat',
  ])
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `${this.config.siteUrl}${req.originalUrl}`);
  }
}
