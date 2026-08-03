import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../common/decorators';
import { deleteProductImage } from '../common/upload';
import { CreateProductDto, StockDto, UpdateProductDto } from './dto/product.dto';

type ProductWithRefs = Product & {
  branch?: { id: string; name: string } | null;
  createdBy?: { name: string } | null;
};

const PRODUCT_INCLUDE = {
  branch: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.ProductInclude;

/** Sum of every part number's quantity — "how many of this product, total". */
export function totalQuantity(p: { partNumbers: Array<{ quantity: number }> }): number {
  return p.partNumbers.reduce((sum, pn) => sum + pn.quantity, 0);
}

/** v1 API product shape (snake_case) that the admin/workers frontends expect. */
export function toApiProduct(p: ProductWithRefs) {
  return {
    id: p.id,
    slug: p.slug,
    part_numbers: p.partNumbers.map((pn) => ({ part_number: pn.partNumber, quantity: pn.quantity })),
    name_en: p.nameEn,
    name_fr: p.nameFr,
    name_zh: p.nameZh,
    desc_en: p.descEn,
    desc_fr: p.descFr,
    desc_zh: p.descZh,
    category: p.category,
    brand: p.brand,
    price: p.price,
    quantity: totalQuantity(p),
    image: p.image,
    published: p.published,
    status: p.status,
    branch_id: p.branchId,
    branch_name: p.branch?.name ?? '',
    created_by: p.createdBy?.name ?? '',
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function matchesSearch(p: Product, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  const fields = [p.nameEn, p.nameFr, p.nameZh, p.brand, ...p.partNumbers.map((pn) => pn.partNumber)];
  return fields.some((v) => v.toLowerCase().includes(q));
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Superadmin's main catalog: approved items only (worker submissions awaiting
   * review live in pendingList() instead, so they never get mixed in here).
   * `stock` narrows to 'out' (quantity 0) or 'low' (1..threshold) for the
   * dedicated stock-alert views; `branchId` scopes to one location. Stock is
   * a sum across embedded part numbers, so — unlike a plain scalar field —
   * it can't be filtered in the DB query; narrowed in memory after fetching
   * (fine at this catalog's scale).
   */
  async list(search = '', category = '', opts: { branchId?: string; stock?: string } = {}) {
    const where: Prisma.ProductWhereInput = { status: 'approved' };
    if (category) where.category = category;
    if (opts.branchId) where.branchId = opts.branchId;
    const products = await this.prisma.product.findMany({
      where, include: PRODUCT_INCLUDE, orderBy: { updatedAt: 'desc' },
    });
    const byStock = products.filter((p) => {
      if (opts.stock === 'out') return totalQuantity(p) === 0;
      if (opts.stock === 'low') { const q = totalQuantity(p); return q > 0 && q <= this.config.lowStockThreshold; }
      return true;
    });
    return { products: byStock.filter((p) => matchesSearch(p, search)).map(toApiProduct) };
  }

  /** Worker-submitted products awaiting a superadmin decision. */
  async pendingList() {
    const products = await this.prisma.product.findMany({
      where: { status: 'pending' }, include: PRODUCT_INCLUDE, orderBy: { createdAt: 'asc' },
    });
    return { products: products.map(toApiProduct) };
  }

  async approve(id: string) {
    const product = await this.findById(id);
    if (product.status !== 'pending') throw new BadRequestException('This product is not awaiting approval');
    const updated = await this.prisma.product.update({
      where: { id }, data: { status: 'approved', updatedAt: this.config.now() }, include: PRODUCT_INCLUDE,
    });
    this.realtime.catalogChanged();
    return { product: toApiProduct(updated) };
  }

  async reject(id: string) {
    const product = await this.findById(id);
    if (product.status !== 'pending') throw new BadRequestException('This product is not awaiting approval');
    await this.prisma.product.delete({ where: { id } });
    this.deleteImageFile(product.image);
    return { ok: true };
  }

  /**
   * Superadmin-created products go live immediately (status "approved").
   * Worker-created products are forced to their own branch and land as
   * "pending" — invisible everywhere until a superadmin approves them.
   */
  async create(dto: CreateProductDto, imageFile: Express.Multer.File | undefined, actor: AuthUser) {
    let branchId: string;
    let status: string;
    if (actor.role === 'worker') {
      const worker = await this.prisma.user.findUnique({ where: { id: actor.id } });
      if (!worker?.branchId) {
        if (imageFile) this.deleteImageFile(imageFile.path);
        throw new BadRequestException('Your account has no branch assigned — ask the superadmin to set one');
      }
      branchId = worker.branchId;
      status = 'pending';
    } else {
      branchId = dto.branch_id ?? (await this.defaultBranchId());
      status = 'approved';
    }

    const product = await this.prisma.product.create({
      data: {
        slug: await this.uniqueSlug(dto.name_en),
        partNumbers: dto.part_numbers.map((pn) => ({ partNumber: pn.part_number, quantity: pn.quantity })),
        nameEn: dto.name_en.trim(),
        nameFr: dto.name_fr ?? '',
        nameZh: dto.name_zh ?? '',
        descEn: dto.desc_en ?? '',
        descFr: dto.desc_fr ?? '',
        descZh: dto.desc_zh ?? '',
        category: dto.category || 'accessories',
        brand: dto.brand ?? '',
        price: dto.price,
        image: imageFile ? imageFile.path : '',
        published: dto.published ?? 1,
        status,
        branchId,
        createdById: actor.id,
        createdAt: this.config.now(),
        updatedAt: this.config.now(),
      },
      include: PRODUCT_INCLUDE,
    });
    this.realtime.catalogChanged();
    return { product: toApiProduct(product) };
  }

  async update(id: string, dto: UpdateProductDto, imageFile?: Express.Multer.File) {
    const product = await this.findById(id, imageFile);
    const data: Record<string, unknown> = {};
    const map: Record<string, keyof UpdateProductDto> = {
      nameEn: 'name_en', nameFr: 'name_fr', nameZh: 'name_zh',
      descEn: 'desc_en', descFr: 'desc_fr', descZh: 'desc_zh',
      category: 'category', brand: 'brand',
      price: 'price', published: 'published', branchId: 'branch_id',
    };
    for (const [column, field] of Object.entries(map)) {
      if (dto[field] !== undefined) data[column] = dto[field];
    }
    if (dto.part_numbers !== undefined) {
      data.partNumbers = dto.part_numbers.map((pn) => ({ partNumber: pn.part_number, quantity: pn.quantity }));
    }
    if (imageFile) {
      this.deleteImageFile(product.image);
      data.image = imageFile.path;
    }
    if (!Object.keys(data).length) return { product: toApiProduct(product) };

    data.updatedAt = this.config.now();
    const updated = await this.prisma.product.update({ where: { id: product.id }, data, include: PRODUCT_INCLUDE });
    this.realtime.catalogChanged();
    return { product: toApiProduct(updated) };
  }

  /** Restocks (or corrects) one specific part number's quantity — the others are untouched. */
  async adjustStock(id: string, dto: StockDto) {
    const product = await this.findById(id);
    const entry = product.partNumbers.find((pn) => pn.partNumber === dto.part_number);
    if (!entry) throw new BadRequestException(`Part number "${dto.part_number}" not found on this product`);

    let quantity: number | undefined;
    if (dto.delta !== undefined) quantity = entry.quantity + dto.delta;
    else if (dto.quantity !== undefined) quantity = dto.quantity;
    if (quantity === undefined || !Number.isFinite(quantity) || quantity < 0) {
      throw new BadRequestException('Resulting quantity must be a non-negative number');
    }

    const partNumbers = product.partNumbers.map((pn) =>
      pn.partNumber === dto.part_number ? { partNumber: pn.partNumber, quantity } : pn,
    );
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: { partNumbers, updatedAt: this.config.now() },
      include: PRODUCT_INCLUDE,
    });
    this.realtime.catalogChanged();
    return { product: toApiProduct(updated) };
  }

  /**
   * Always a real delete: removes the row and purges its Cloudinary image,
   * even if it has sales history. Old sales/receipts referencing this id
   * still display fine afterward — they snapshot what they need at the time
   * (a receipt line never re-reads the live product; a sale row falls back
   * to "(deleted product)" — see toApiSale in sales.service.ts).
   */
  async remove(id: string) {
    const product = await this.findById(id);
    await this.prisma.product.delete({ where: { id: product.id } });
    this.deleteImageFile(product.image);
    this.realtime.catalogChanged();
    return { ok: true };
  }

  /** Bulk delete — all products, or every product in one category. Always a real delete (see remove() above). */
  async removeAll(category?: string) {
    const where = category ? { category } : {};
    const matching = await this.prisma.product.findMany({ where, select: { id: true, image: true } });
    if (!matching.length) return { deleted: 0, total: 0 };

    await this.prisma.product.deleteMany({ where: { id: { in: matching.map((p) => p.id) } } });
    for (const p of matching) this.deleteImageFile(p.image);
    this.realtime.catalogChanged();
    return { deleted: matching.length, total: matching.length };
  }

  private async findById(id: string, uploadedFile?: Express.Multer.File): Promise<ProductWithRefs> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    if (!product) {
      // Don't leave orphaned uploads behind when the target row is missing.
      if (uploadedFile) this.deleteImageFile(uploadedFile.path);
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async defaultBranchId(): Promise<string> {
    const first = await this.prisma.branch.findFirst({ orderBy: { id: 'asc' } });
    if (!first) throw new BadRequestException('Create a branch first (Admin > Branches)');
    return first.id;
  }

  private deleteImageFile(image: string): void {
    deleteProductImage(image);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'product';
    let slug = base;
    let i = 2;
    while (await this.prisma.product.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }
}
