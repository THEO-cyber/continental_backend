import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import * as path from 'path';
import { AppConfig } from '../config/app.config';
import { Public } from '../common/decorators';

/** PWA files must be served from the root scope ('/'), not /assets. */
@Public()
@Controller()
export class RootFilesController {
  constructor(private readonly config: AppConfig) {}

  private clientPublic(...p: string[]): string {
    return path.join(this.config.clientDir, 'public', ...p);
  }

  @Get('manifest.webmanifest')
  manifest(@Res() res: Response) {
    res.type('application/manifest+json').sendFile(this.clientPublic('manifest.webmanifest'));
  }

  @Get('sw.js')
  sw(@Res() res: Response) {
    res.set('Cache-Control', 'no-cache').sendFile(this.clientPublic('sw.js'));
  }

  @Get('offline.html')
  offline(@Res() res: Response) {
    res.sendFile(this.clientPublic('offline.html'));
  }
}
