import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Sale } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../common/decorators';
import { toCsv } from '../common/csv.util';

type SaleWithRefs = Sale & {
  product: { nameEn: string; sku: string | null; image: string };
  worker: { name: string };
};

/** v1 sale-detail shape (snake_case) used by the admin and workers frontends. */
function toApiSale(s: SaleWithRefs) {
  return {
    id: s.id,
    product_id: s.productId,
    quantity: s.quantity,
    unit_price: s.unitPrice,
    total: s.total,
    sale_date: s.saleDate,
    created_at: s.createdAt,
    product_name: s.product.nameEn,
    sku: s.product.sku ?? '',
    image: s.product.image,
    worker_name: s.worker.name,
  };
}

const SALE_INCLUDE = {
  product: { select: { nameEn: true, sku: true, image: true } },
  worker: { select: { name: true } },
} satisfies Prisma.SaleInclude;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Records a sale atomically. The conditional decrement (quantity >= sold)
   * makes overselling impossible even with many server replicas on PostgreSQL.
   * Price is not locked to the product's reference price: the worker can enter
   * the price actually sold at (parts prices are negotiated/vary); omitting it
   * falls back to the product's current reference price.
   */
  async record(actor: AuthUser, productId: string, quantity: number, unitPriceOverride?: number) {
    const saleId = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException('Product not found');
      const decremented = await tx.product.updateMany({
        where: { id: productId, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity }, updatedAt: this.config.now() },
      });
      if (!decremented.count) throw new ConflictException(`Only ${product.quantity} left in stock`);
      const unitPrice = unitPriceOverride ?? product.price;
      const created = await tx.sale.create({
        data: {
          productId,
          workerId: actor.id,
          quantity,
          unitPrice,
          total: unitPrice * quantity,
          saleDate: this.config.todayInCameroon(),
          createdAt: this.config.now(),
        },
      });
      return created.id;
    });

    const sale = await this.prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: SALE_INCLUDE,
    });
    const apiSale = toApiSale(sale);
    this.realtime.saleRecorded(apiSale);
    this.realtime.catalogChanged(); // stock changed everywhere
    return { sale: apiSale };
  }

  async mineToday(actor: AuthUser) {
    const date = this.config.todayInCameroon();
    const sales = await this.prisma.sale.findMany({
      where: { workerId: actor.id, saleDate: date },
      include: SALE_INCLUDE,
      orderBy: { id: 'desc' },
    });
    return {
      date,
      sales: sales.map(toApiSale),
      total: sales.reduce((sum, s) => sum + s.total, 0),
    };
  }

  /** Per-day report: each product with quantity sold and amount + grand total. */
  async daily(dateParam?: string) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam! : this.config.todayInCameroon();
    const [grouped, detail] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['productId'],
        where: { saleDate: date },
        _sum: { quantity: true, total: true },
      }),
      this.prisma.sale.findMany({
        where: { saleDate: date },
        include: SALE_INCLUDE,
        orderBy: { id: 'desc' },
      }),
    ]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, nameEn: true, sku: true, image: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const rows = grouped
      .map((g) => ({
        product_id: g.productId,
        product_name: byId.get(g.productId)?.nameEn ?? '',
        sku: byId.get(g.productId)?.sku ?? '',
        image: byId.get(g.productId)?.image ?? '',
        quantity: g._sum.quantity ?? 0,
        amount: g._sum.total ?? 0,
      }))
      .sort((a, b) => b.amount - a.amount);
    return {
      date,
      rows,
      detail: detail.map(toApiSale),
      total: rows.reduce((sum, r) => sum + r.amount, 0),
      itemsSold: rows.reduce((sum, r) => sum + r.quantity, 0),
    };
  }

  /** Day-by-day totals for the last N days (default 30). */
  async summary(daysParam?: string) {
    const days = Math.min(Math.max(Number(daysParam) || 30, 1), 365);
    const grouped = await this.prisma.sale.groupBy({
      by: ['saleDate'],
      _sum: { total: true, quantity: true },
      _count: { _all: true },
      orderBy: { saleDate: 'desc' },
      take: days,
    });
    return {
      days: grouped.map((g) => ({
        sale_date: g.saleDate,
        amount: g._sum.total ?? 0,
        quantity: g._sum.quantity ?? 0,
        transactions: g._count._all,
      })),
    };
  }

  /** Resolves a period + anchor date into an inclusive [from, to] sale_date range. */
  private periodRange(period: string, dateParam?: string): { from: string; to: string; label: string } {
    const today = this.config.todayInCameroon();
    if (period === 'year') {
      const year = /^\d{4}$/.test(dateParam || '') ? dateParam! : today.slice(0, 4);
      return { from: `${year}-01-01`, to: `${year}-12-31`, label: year };
    }
    if (period === 'month') {
      const ym = /^\d{4}-\d{2}$/.test(dateParam || '') ? dateParam! : today.slice(0, 7);
      const [y, m] = ym.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, '0')}`, label: ym };
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam! : today;
    return { from: date, to: date, label: date };
  }

  /**
   * One worker's sales for a day, month or year: itemized product totals, full
   * transaction detail, and a breakdown (by day within a month, by month within
   * a year) so the superadmin can find any worker's activity without digging
   * through a mixed, all-worker report.
   */
  async workerReport(workerId: string, periodParam?: string, dateParam?: string) {
    const period = ['day', 'month', 'year'].includes(periodParam || '') ? periodParam! : 'day';
    const worker = await this.prisma.user.findFirst({ where: { id: workerId, role: 'worker' } });
    if (!worker) throw new NotFoundException('Worker not found');
    const { from, to, label } = this.periodRange(period, dateParam);

    const [grouped, detail, dailyBreakdown] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['productId'],
        where: { workerId, saleDate: { gte: from, lte: to } },
        _sum: { quantity: true, total: true },
      }),
      this.prisma.sale.findMany({
        where: { workerId, saleDate: { gte: from, lte: to } },
        include: SALE_INCLUDE,
        orderBy: { id: 'desc' },
      }),
      this.prisma.sale.groupBy({
        by: ['saleDate'],
        where: { workerId, saleDate: { gte: from, lte: to } },
        _sum: { quantity: true, total: true },
        _count: { _all: true },
        orderBy: { saleDate: 'asc' },
      }),
    ]);

    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, nameEn: true, sku: true, image: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const rows = grouped
      .map((g) => ({
        product_id: g.productId,
        product_name: byId.get(g.productId)?.nameEn ?? '',
        sku: byId.get(g.productId)?.sku ?? '',
        image: byId.get(g.productId)?.image ?? '',
        quantity: g._sum.quantity ?? 0,
        amount: g._sum.total ?? 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    let breakdown = dailyBreakdown.map((d) => ({
      key: d.saleDate,
      quantity: d._sum.quantity ?? 0,
      amount: d._sum.total ?? 0,
      transactions: d._count._all,
    }));
    if (period === 'year') {
      // Fold daily rows into months so a year view stays a compact 12 rows.
      const byMonth = new Map<string, { quantity: number; amount: number; transactions: number }>();
      for (const d of breakdown) {
        const mk = d.key.slice(0, 7);
        const cur = byMonth.get(mk) || { quantity: 0, amount: 0, transactions: 0 };
        cur.quantity += d.quantity;
        cur.amount += d.amount;
        cur.transactions += d.transactions;
        byMonth.set(mk, cur);
      }
      breakdown = [...byMonth.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => a.key.localeCompare(b.key));
    }

    return {
      worker: { id: worker.id, name: worker.name, username: worker.username },
      period, from, to, label,
      rows,
      detail: detail.map(toApiSale),
      breakdown,
      total: rows.reduce((sum, r) => sum + r.amount, 0),
      itemsSold: rows.reduce((sum, r) => sum + r.quantity, 0),
      transactions: detail.length,
    };
  }

  /** CSV export of one worker's transactions for a period — for offline/company records. */
  async workerExportCsv(workerId: string, period?: string, date?: string): Promise<{ filename: string; csv: string }> {
    const report = await this.workerReport(workerId, period, date);
    const header = ['Sale ID', 'Date', 'Time', 'Product', 'SKU', 'Quantity', 'Unit Price (FCFA)', 'Total (FCFA)'];
    const rows = report.detail.map((s) => [
      s.id, s.sale_date, s.created_at, s.product_name, s.sku, s.quantity, s.unit_price, s.total,
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = report.worker.username.replace(/[^a-z0-9_-]/gi, '');
    return { filename: `sales-${safeName}-${report.label}.csv`, csv };
  }

  /** Full sales ledger export — every business record, optionally filtered by date range/worker. */
  async exportLedgerCsv(params: { from?: string; to?: string; workerId?: string }): Promise<{ filename: string; csv: string }> {
    const where: Prisma.SaleWhereInput = {};
    if (params.from || params.to) {
      where.saleDate = {};
      if (params.from) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(params.from)) throw new BadRequestException('Invalid "from" date');
        (where.saleDate as Prisma.StringFilter).gte = params.from;
      }
      if (params.to) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(params.to)) throw new BadRequestException('Invalid "to" date');
        (where.saleDate as Prisma.StringFilter).lte = params.to;
      }
    }
    if (params.workerId) where.workerId = params.workerId;

    const sales = await this.prisma.sale.findMany({ where, include: SALE_INCLUDE, orderBy: { id: 'asc' } });
    const header = ['Sale ID', 'Date', 'Time', 'Worker', 'Product', 'SKU', 'Quantity', 'Unit Price (FCFA)', 'Total (FCFA)'];
    const rows = sales.map((s) => [
      s.id, s.saleDate, s.createdAt, s.worker.name, s.product.nameEn, s.product.sku ?? '',
      s.quantity, s.unitPrice, s.total,
    ]);
    const csv = toCsv([header, ...rows]);
    const range = params.from || params.to ? `${params.from || 'start'}_to_${params.to || 'now'}` : 'all';
    return { filename: `continental-sales-${range}.csv`, csv };
  }

  /** Corrects a mistaken sale: removes it and restores the stock. */
  async remove(id: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id } });
    if (!sale) throw new NotFoundException('Sale not found');
    await this.prisma.$transaction([
      this.prisma.sale.delete({ where: { id: sale.id } }),
      this.prisma.product.update({
        where: { id: sale.productId },
        data: { quantity: { increment: sale.quantity }, updatedAt: this.config.now() },
      }),
    ]);
    this.realtime.catalogChanged();
    return { ok: true };
  }
}
