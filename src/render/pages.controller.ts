import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { RenderService } from './render.service';
import { AppConfig } from '../config/app.config';
import { Public } from '../common/decorators';

@Public()
@Controller()
export class PagesController {
  constructor(
    private readonly render: RenderService,
    private readonly config: AppConfig,
  ) {}

  @Get('sitemap.xml')
  async sitemap(@Res() res: Response) {
    res.type('application/xml').send(await this.render.renderSitemap());
  }

  @Get('robots.txt')
  robots(@Res() res: Response) {
    res.type('text/plain').send(this.render.renderRobots());
  }

  @Get()
  root(@Headers('accept-language') acceptLanguage: string, @Res() res: Response) {
    res.redirect(302, `/${this.render.pickLang(acceptLanguage)}`);
  }

  @Get(':lang')
  async home(@Param('lang') lang: string, @Res() res: Response) {
    if (!(this.config.langs as readonly string[]).includes(lang)) {
      return res.redirect(302, '/');
    }
    res.set('Cache-Control', 'no-cache').type('html').send(await this.render.renderHome(lang));
  }

  @Get(':lang/product/:slug')
  async product(@Param('lang') lang: string, @Param('slug') slug: string, @Res() res: Response) {
    if (!(this.config.langs as readonly string[]).includes(lang)) {
      return res.redirect(302, '/');
    }
    const html = await this.render.renderProduct(lang, slug);
    if (!html) {
      return res.status(404).set('Cache-Control', 'no-cache').type('html')
        .send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>404</title></head>
<body style="font-family:system-ui;text-align:center;padding:4rem"><h1>404</h1><p><a href="/${lang}">Continental Auto Parts</a></p></body></html>`);
    }
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  }
}
