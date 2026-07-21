import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateBranchDto } from './dto/branch.dto';

const LOW_STOCK_THRESHOLD = 5;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  /** Branch list with per-branch inventory stats — how superadmin tracks stock per location. */
  async list() {
    const branches = await this.prisma.branch.findMany({ orderBy: { id: 'asc' } });
    const products = await this.prisma.product.findMany({
      where: { status: 'approved' },
      select: { branchId: true, quantity: true },
    });
    const workerCounts = await this.prisma.user.groupBy({
      by: ['branchId'],
      where: { role: 'worker' },
      _count: { _all: true },
    });
    const workerCountByBranch = new Map(workerCounts.map((w) => [w.branchId, w._count._all]));

    return {
      branches: branches.map((b) => {
        const items = products.filter((p) => p.branchId === b.id);
        return {
          id: b.id,
          name: b.name,
          city: b.city,
          active: b.active,
          created_at: b.createdAt,
          product_count: items.length,
          out_of_stock: items.filter((p) => p.quantity === 0).length,
          low_stock: items.filter((p) => p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD).length,
          worker_count: workerCountByBranch.get(b.id) ?? 0,
        };
      }),
    };
  }

  async create(dto: CreateBranchDto) {
    const branch = await this.prisma.branch.create({
      data: { name: dto.name.trim(), city: dto.city?.trim() ?? '', createdAt: this.config.now() },
    });
    this.realtime.catalogChanged();
    return { branch: { id: branch.id, name: branch.name, city: branch.city, active: branch.active } };
  }

  async remove(id: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Branch not found');
    const [productCount, workerCount] = await Promise.all([
      this.prisma.product.count({ where: { branchId: id } }),
      this.prisma.user.count({ where: { branchId: id } }),
    ]);
    if (productCount || workerCount) {
      throw new ConflictException('This branch still has products or workers assigned — move or remove them first');
    }
    const remaining = await this.prisma.branch.count();
    if (remaining <= 1) throw new BadRequestException('At least one branch must exist');
    await this.prisma.branch.delete({ where: { id } });
    this.realtime.catalogChanged();
    return { ok: true };
  }
}
