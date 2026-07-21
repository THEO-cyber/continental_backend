import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api/admin/settings')
@Roles('superadmin')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get()
  async get() {
    return { settings: await this.settings.getAll() };
  }

  @Put()
  async put(@Body() body: Record<string, unknown>) {
    await this.settings.setMany(body || {});
    this.realtime.catalogChanged(); // contact info appears on the public site
    return { settings: await this.settings.getAll() };
  }
}
