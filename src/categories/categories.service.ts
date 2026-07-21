import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateCategoryDto } from './dto/category.dto';

function toApi(c: { id: number; key: string; nameEn: string; nameFr: string; nameZh: string }) {
  return { id: c.id, key: c.key, name_en: c.nameEn, name_fr: c.nameFr, name_zh: c.nameZh };
}

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  async list() {
    const categories = await this.prisma.category.findMany({ orderBy: { id: 'asc' } });
    const products = await this.prisma.product.groupBy({ by: ['category'], _count: { _all: true } });
    const counts = new Map(products.map((p) => [p.category, p._count._all]));
    return { categories: categories.map((c) => ({ ...toApi(c), product_count: counts.get(c.key) ?? 0 })) };
  }

  async create(dto: CreateCategoryDto) {
    const base = slugify(dto.name_en);
    let key = base;
    let i = 2;
    while (await this.prisma.category.findUnique({ where: { key } })) key = `${base}-${i++}`;

    const category = await this.prisma.category.create({
      data: {
        key,
        nameEn: dto.name_en.trim(),
        nameFr: dto.name_fr?.trim() || dto.name_en.trim(),
        nameZh: dto.name_zh?.trim() || dto.name_en.trim(),
        createdAt: this.config.now(),
      },
    });
    this.realtime.catalogChanged();
    return { category: toApi(category) };
  }

  async remove(id: number) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    const inUse = await this.prisma.product.count({ where: { category: category.key } });
    if (inUse) throw new ConflictException(`${inUse} product(s) still use this category — move or delete them first`);
    const remaining = await this.prisma.category.count();
    if (remaining <= 1) throw new BadRequestException('At least one category must exist');
    await this.prisma.category.delete({ where: { id } });
    this.realtime.catalogChanged();
    return { ok: true };
  }
}
