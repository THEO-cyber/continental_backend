import 'reflect-metadata';
import * as crypto from 'crypto';
import { MongoClient } from 'mongodb';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

// Points at a real MongoDB server — the local Docker container for local
// runs, the CI service container in CI. Never the real production database:
// each test file gets its own throwaway database (created here, indexed,
// then dropped in closeTestApp), the same isolation the earlier
// throwaway-SQLite/Postgres approaches gave, just on the engine production
// actually runs on.
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'mongodb://localhost:57017/?replicaSet=rs0&directConnection=true';

// Mirrors schema.prisma's @unique / @@index declarations — kept here instead
// of shelling out to `prisma db push` per test file, which would make an
// 80s suite into a multi-minute one for no benefit (there's only one schema,
// no migration history to replay).
async function createIndexes(client: MongoClient, dbName: string): Promise<void> {
  const db = client.db(dbName);
  await Promise.all([
    db.collection('users').createIndex({ username: 1 }, { unique: true }),
    db.collection('categories').createIndex({ key: 1 }, { unique: true }),
    db.collection('products').createIndex({ slug: 1 }, { unique: true }),
    db.collection('products').createIndex({ published: 1 }),
    db.collection('products').createIndex({ status: 1 }),
    db.collection('products').createIndex({ branch_id: 1 }),
    db.collection('sales').createIndex({ sale_date: 1 }),
    db.collection('sales').createIndex({ product_id: 1 }),
    db.collection('sales').createIndex({ worker_id: 1 }),
    db.collection('receipts').createIndex({ receipt_number: 1 }, { unique: true }),
    db.collection('receipts').createIndex({ created_at: 1 }),
    db.collection('receipt_items').createIndex({ receipt_id: 1 }),
  ]);
}

export async function createTestApp(): Promise<{ app: INestApplication; dbName: string }> {
  const dbName = 'test_' + crypto.randomBytes(8).toString('hex');

  const client = new MongoClient(ADMIN_URL);
  await client.connect();
  await createIndexes(client, dbName);
  await client.close();

  // Insert the db name between the host and the query string, e.g.
  // mongodb://localhost:57017/?replicaSet=rs0 -> mongodb://localhost:57017/test_xyz?replicaSet=rs0
  process.env.DATABASE_URL = ADMIN_URL.includes('/?')
    ? ADMIN_URL.replace('/?', `/${dbName}?`)
    : `${ADMIN_URL.replace(/\/$/, '')}/${dbName}`;
  process.env.JWT_SECRET = 'test-secret-' + crypto.randomBytes(24).toString('hex');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, dbName };
}

export async function closeTestApp(app: INestApplication, dbName: string): Promise<void> {
  await app.close();
  const client = new MongoClient(ADMIN_URL);
  await client.connect();
  await client.db(dbName).dropDatabase();
  await client.close();
}

export const SUPERADMIN = { username: 'admin', password: 'Continental@2026' };
