import { Injectable } from '@nestjs/common';
import { PrismaService, DEFAULT_SETTINGS } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany();
    const out: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  async setMany(patch: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(patch).filter(([key]) => key in DEFAULT_SETTINGS);
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value: String(value ?? '') },
          update: { value: String(value ?? '') },
        }),
      ),
    );
  }
}
