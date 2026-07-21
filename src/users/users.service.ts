import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { RealtimeService } from '../realtime/realtime.service';
import { hashPassword } from '../common/crypto.util';
import { CreateWorkerDto, PatchWorkerDto } from './dto/worker.dto';

type WorkerWithBranch = User & { branch: { id: string; name: string } | null };

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  /** Workers with today's performance — v1 response shape (snake_case). */
  async listWorkers() {
    const today = this.config.todayInCameroon();
    const [workers, todayAgg] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'worker' },
        include: { branch: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.sale.groupBy({
        by: ['workerId'],
        where: { saleDate: today },
        _sum: { total: true, quantity: true },
      }),
    ]);
    const agg = new Map(todayAgg.map((a) => [a.workerId, a._sum]));
    return {
      workers: workers.map((w) => ({
        id: w.id,
        username: w.username,
        name: w.name,
        active: w.active,
        branch_id: w.branchId,
        branch_name: w.branch?.name ?? '',
        created_at: w.createdAt,
        today_amount: agg.get(w.id)?.total ?? 0,
        today_items: agg.get(w.id)?.quantity ?? 0,
      })),
    };
  }

  async createWorker(dto: CreateWorkerDto) {
    const existing = await this.prisma.user.findFirst({
      where: { username: { equals: dto.username } },
    });
    if (existing) throw new ConflictException('That username is already taken');
    const branchId = await this.resolveBranchId(dto.branch_id);
    const worker = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash: hashPassword(dto.password),
        name: dto.name.trim(),
        role: 'worker',
        branchId,
        createdAt: this.config.now(),
      },
      include: { branch: { select: { id: true, name: true } } },
    });
    this.realtime.catalogChanged();
    return { worker: this.publicShape(worker) };
  }

  async patchWorker(id: string, dto: PatchWorkerDto) {
    const worker = await this.findWorker(id);
    const data: { active?: number; passwordHash?: string; branchId?: string } = {};
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.password !== undefined) data.passwordHash = hashPassword(dto.password);
    if (dto.branch_id !== undefined) data.branchId = await this.resolveBranchId(dto.branch_id);
    const updated = Object.keys(data).length
      ? await this.prisma.user.update({
          where: { id: worker.id }, data, include: { branch: { select: { id: true, name: true } } },
        })
      : await this.prisma.user.findUniqueOrThrow({
          where: { id: worker.id }, include: { branch: { select: { id: true, name: true } } },
        });
    this.realtime.catalogChanged();
    return { worker: this.publicShape(updated) };
  }

  async deleteWorker(id: string) {
    const worker = await this.findWorker(id);
    const hasSales = await this.prisma.sale.findFirst({ where: { workerId: worker.id } });
    if (hasSales) {
      // Keep reporting history intact — deactivate instead of hard delete.
      await this.prisma.user.update({ where: { id: worker.id }, data: { active: 0 } });
      this.realtime.catalogChanged();
      return { ok: true, archived: true, message: 'Worker has sales history; account was deactivated instead of deleted.' };
    }
    await this.prisma.user.delete({ where: { id: worker.id } });
    this.realtime.catalogChanged();
    return { ok: true, archived: false };
  }

  private async resolveBranchId(requested?: string): Promise<string> {
    if (requested) {
      const branch = await this.prisma.branch.findUnique({ where: { id: requested } });
      if (!branch) throw new BadRequestException('Branch not found');
      return branch.id;
    }
    const first = await this.prisma.branch.findFirst({ orderBy: { id: 'asc' } });
    if (!first) throw new BadRequestException('Create a branch first (Admin > Branches)');
    return first.id;
  }

  private async findWorker(id: string) {
    const worker = await this.prisma.user.findFirst({ where: { id, role: 'worker' } });
    if (!worker) throw new NotFoundException('Worker not found');
    return worker;
  }

  private publicShape(w: WorkerWithBranch) {
    return {
      id: w.id, username: w.username, name: w.name, active: w.active,
      branch_id: w.branchId, branch_name: w.branch?.name ?? '',
    };
  }
}
