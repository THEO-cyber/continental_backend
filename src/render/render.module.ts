import { Module } from '@nestjs/common';
import { RenderService } from './render.service';
import { PagesController } from './pages.controller';
import { RootFilesController } from './root-files.controller';

@Module({
  // Order matters: specific root files must be matched before the :lang catch-all.
  controllers: [RootFilesController, PagesController],
  providers: [RenderService],
})
export class RenderModule {}
