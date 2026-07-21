import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Receipt, ReceiptItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { AuthUser } from '../common/decorators';
import { CreateReceiptDto } from './dto/receipt.dto';

type ReceiptWithRefs = Receipt & { items: ReceiptItem[]; issuedBy: { name: string } };

export interface ApiReceipt {
  id: number;
  receipt_number: string;
  buyer_type: string;
  buyer_name: string;
  buyer_phone: string;
  buyer_address: string;
  notes: string;
  subtotal: number;
  total: number;
  issued_by: string;
  created_at: string;
  items: Array<{
    id: number; product_id: number | null; product_name: string; sku: string;
    quantity: number; unit_price: number; total: number;
  }>;
}

function toApi(r: ReceiptWithRefs): ApiReceipt {
  return {
    id: r.id,
    receipt_number: r.receiptNumber,
    buyer_type: r.buyerType,
    buyer_name: r.buyerName,
    buyer_phone: r.buyerPhone,
    buyer_address: r.buyerAddress,
    notes: r.notes,
    subtotal: r.subtotal,
    total: r.total,
    issued_by: r.issuedBy.name,
    created_at: r.createdAt,
    items: r.items.map((i) => ({
      id: i.id, product_id: i.productId, product_name: i.productName, sku: i.sku,
      quantity: i.quantity, unit_price: i.unitPrice, total: i.total,
    })),
  };
}

const RECEIPT_INCLUDE = {
  items: true,
  issuedBy: { select: { name: true } },
} satisfies Prisma.ReceiptInclude;

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async create(actor: AuthUser, dto: CreateReceiptDto): Promise<{ receipt: ApiReceipt }> {
    const productIds = dto.items.map((i) => i.product_id).filter((id): id is number => !!id);
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    const itemsData = dto.items.map((item, idx) => {
      const product = item.product_id ? byId.get(item.product_id) : undefined;
      const name = item.product_name?.trim() || product?.nameEn;
      if (!name) throw new BadRequestException(`Item ${idx + 1} needs a product or a name`);
      const unitPrice = item.unit_price ?? product?.price;
      if (unitPrice === undefined) throw new BadRequestException(`Item ${idx + 1} needs a price`);
      const quantity = item.quantity;
      return {
        productId: item.product_id ?? null,
        productName: name,
        sku: item.sku || product?.sku || '',
        quantity,
        unitPrice,
        total: unitPrice * quantity,
      };
    });
    const total = itemsData.reduce((sum, it) => sum + it.total, 0);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.receipt.create({
        data: {
          receiptNumber: 'PENDING',
          buyerType: dto.buyer_type,
          buyerName: dto.buyer_name.trim(),
          buyerPhone: dto.buyer_phone?.trim() ?? '',
          buyerAddress: dto.buyer_address?.trim() ?? '',
          notes: dto.notes?.trim() ?? '',
          subtotal: total,
          total,
          issuedById: actor.id,
          createdAt: this.config.now(),
          items: { create: itemsData },
        },
        include: RECEIPT_INCLUDE,
      });
      const receiptNumber = `CT-${new Date().getFullYear()}-${String(row.id).padStart(6, '0')}`;
      return tx.receipt.update({ where: { id: row.id }, data: { receiptNumber }, include: RECEIPT_INCLUDE });
    });

    return { receipt: toApi(created) };
  }

  async list(params: { from?: string; to?: string; search?: string }) {
    const where: Prisma.ReceiptWhereInput = {};
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) (where.createdAt as Prisma.StringFilter).gte = params.from;
      if (params.to) (where.createdAt as Prisma.StringFilter).lte = params.to + ' 23:59:59';
    }
    if (params.search) {
      where.OR = [
        { buyerName: { contains: params.search } },
        { receiptNumber: { contains: params.search } },
      ];
    }
    const receipts = await this.prisma.receipt.findMany({
      where, include: RECEIPT_INCLUDE, orderBy: { id: 'desc' }, take: 300,
    });
    return {
      receipts: receipts.map(toApi),
      totalAmount: receipts.reduce((sum, r) => sum + r.total, 0),
    };
  }

  async findOne(id: number): Promise<ApiReceipt> {
    const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return toApi(receipt);
  }
}
