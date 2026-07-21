import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/app.config';
import { hashPassword } from '../common/crypto.util';

// The 11 categories that already exist in the client-site i18n files and the
// admin UI — seeded once so nothing changes visually; new ones a superadmin
// adds afterward are stored the same way (Admin > Categories).
const DEFAULT_CATEGORIES: Array<{ key: string; nameEn: string; nameFr: string; nameZh: string }> = [
  { key: 'engine', nameEn: 'Engine Parts', nameFr: 'Pièces Moteur', nameZh: '发动机配件' },
  { key: 'brakes', nameEn: 'Braking System', nameFr: 'Système de Freinage', nameZh: '制动系统' },
  { key: 'suspension', nameEn: 'Suspension & Steering', nameFr: 'Suspension & Direction', nameZh: '悬挂与转向' },
  { key: 'transmission', nameEn: 'Transmission', nameFr: 'Transmission', nameZh: '变速箱' },
  { key: 'electrical', nameEn: 'Electrical & Batteries', nameFr: 'Électricité & Batteries', nameZh: '电气与电瓶' },
  { key: 'filters', nameEn: 'Filters', nameFr: 'Filtres', nameZh: '滤清器' },
  { key: 'cooling', nameEn: 'Cooling System', nameFr: 'Système de Refroidissement', nameZh: '冷却系统' },
  { key: 'body', nameEn: 'Body Parts', nameFr: 'Carrosserie', nameZh: '车身件' },
  { key: 'lubricants', nameEn: 'Oils & Lubricants', nameFr: 'Huiles & Lubrifiants', nameZh: '机油与润滑油' },
  { key: 'tires', nameEn: 'Tires & Wheels', nameFr: 'Pneus & Jantes', nameZh: '轮胎与轮毂' },
  { key: 'accessories', nameEn: 'Accessories', nameFr: 'Accessoires', nameZh: '配件用品' },
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  phone: '+237 676 975 012',
  whatsapp: '+237676975012',
  email: 'contofils@gmail.com',
  address: 'B.P. 135, Kribi, Cameroon',
  hours: 'Mon - Sat: 8:00 - 18:00',
  facebook: '',
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfig) {
    super();
  }

  // Indexes come from `prisma db push` (run as its own deploy step — see
  // package.json's `start` script — not here). MongoDB is schemaless at the
  // storage layer, so "structure" beyond that is just this seed: first-run
  // data via plain Prisma Client calls.
  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.seed();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private async seed(): Promise<void> {
    const admins = await this.user.count({ where: { role: 'superadmin' } });
    if (!admins) {
      await this.user.create({
        data: {
          username: 'admin',
          passwordHash: hashPassword('Continental@2026'),
          name: 'Anyaegbu Chukwuma',
          role: 'superadmin',
          createdAt: this.config.now(),
        },
      });
      this.logger.warn('First run: superadmin created — username "admin", password "Continental@2026". CHANGE IT in Admin > Settings.');
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await this.setting.upsert({ where: { key }, create: { key, value }, update: {} });
    }

    // Ensure at least one branch exists — new products/workers default here.
    let defaultBranch = await this.branch.findFirst({ orderBy: { id: 'asc' } });
    if (!defaultBranch) {
      defaultBranch = await this.branch.create({
        data: {
          name: `${this.config.business.city} Main Branch`,
          city: this.config.business.city,
          createdAt: this.config.now(),
        },
      });
      this.logger.warn(`First run: default branch "${defaultBranch.name}" created — add more in Admin > Branches.`);
    }

    for (const c of DEFAULT_CATEGORIES) {
      await this.category.upsert({
        where: { key: c.key },
        create: { key: c.key, nameEn: c.nameEn, nameFr: c.nameFr, nameZh: c.nameZh, createdAt: this.config.now() },
        update: {},
      });
    }
  }
}
