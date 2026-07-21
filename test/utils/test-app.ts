import 'reflect-metadata';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

/**
 * Boots a full Nest app against a throwaway SQLite file in the OS temp dir —
 * never the real continental_backend/data/continental.db. Each call gets its
 * own DB (fresh schema + seed, via PrismaService.onModuleInit), so spec files
 * never see each other's data even though the suite runs --runInBand.
 */
export async function createTestApp(): Promise<{ app: INestApplication; dbFile: string }> {
  const dbFile = path.join(os.tmpdir(), `continental-test-${crypto.randomUUID()}.db`);
  process.env.DB_FILE = dbFile;
  process.env.JWT_SECRET = 'test-secret-' + crypto.randomUUID();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, dbFile };
}

export async function closeTestApp(app: INestApplication, dbFile: string): Promise<void> {
  await app.close();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch { /* already gone */ }
  }
}

export const SUPERADMIN = { username: 'admin', password: 'Continental@2026' };
