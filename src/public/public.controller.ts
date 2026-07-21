import { Controller, Get, Query } from '@nestjs/common';
import { Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { SettingsService } from '../settings/settings.service';
import { matchesSearch, toApiProduct } from '../products/products.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';

@Controller('api')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Public catalog: published AND approved products only. NEVER exposes price,
   * exact quantity, or branch — customers only ever see "product" and "in stock".
   */
  @Public()
  @Get('public/products')
  async publicProducts(
    @Query('lang') langParam = '',
    @Query('search') search = '',
    @Query('category') category = '',
  ) {
    const lang = (this.config.langs as readonly string[]).includes(langParam)
      ? langParam
      : this.config.defaultLang;
    const products = await this.prisma.product.findMany({
      where: { published: 1, status: 'approved', ...(category ? { category } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return {
      products: products
        .filter((p) => matchesSearch(p, search))
        .map((p) => this.toPublicShape(p, lang)),
    };
  }

  /** Public contact/business info (edited by superadmin in Settings). */
  @Public()
  @Get('public/settings')
  async publicSettings() {
    const s = await this.settings.getAll();
    return {
      settings: {
        phone: s.phone, whatsapp: s.whatsapp, email: s.email,
        address: s.address, hours: s.hours, facebook: s.facebook,
      },
      business: this.config.business,
    };
  }

  /**
   * Staff catalog (workers + superadmin): includes price and live stock, plus
   * which branch it's at. Defaults to the worker's own branch; pass
   * branchId=all or a specific branch id to search other locations' stock.
   * Only approved items — a pending submission never appears for sale.
   */
  @Get('staff/products')
  async staffProducts(
    @CurrentUser() user: AuthUser,
    @Query('search') search = '',
    @Query('branchId') branchId?: string,
  ) {
    let scope: number | undefined;
    if (branchId === 'all') {
      scope = undefined;
    } else if (branchId) {
      scope = Number(branchId);
    } else if (user.role === 'worker') {
      const worker = await this.prisma.user.findUnique({ where: { id: user.id } });
      scope = worker?.branchId ?? undefined;
    }

    const products = await this.prisma.product.findMany({
      where: { status: 'approved', ...(scope ? { branchId: scope } : {}) },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { nameEn: 'asc' },
    });
    return {
      products: products.filter((p) => matchesSearch(p, search)).map((p) => {
        const api = toApiProduct(p);
        return {
          id: api.id, slug: api.slug, sku: api.sku,
          name_en: api.name_en, name_fr: api.name_fr,
          category: api.category, brand: api.brand,
          price: api.price, quantity: api.quantity,
          image: api.image, published: api.published,
          branch_id: api.branch_id, branch_name: api.branch_name,
        };
      }),
    };
  }

  private toPublicShape(p: Product, lang: string) {
    const name = { en: p.nameEn, fr: p.nameFr, zh: p.nameZh }[lang] || p.nameEn;
    const description = { en: p.descEn, fr: p.descFr, zh: p.descZh }[lang] || p.descEn;
    return {
      id: p.id,
      slug: p.slug,
      name,
      description,
      category: p.category,
      brand: p.brand,
      image: p.image,
      inStock: p.quantity > 0,
    };
  }
}
