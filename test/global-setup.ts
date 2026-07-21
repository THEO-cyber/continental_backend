import { MongoMemoryReplSet } from 'mongodb-memory-server';

// One shared in-memory MongoDB replica set for the whole test run (Prisma's
// Mongo connector requires replica-set mode even for plain writes). Each spec
// file still gets its own throwaway database within it — see test-app.ts.
// Overridable via TEST_DATABASE_ADMIN_URL to point at a real server instead
// (e.g. the local Docker container) when that's preferred.
export default async function globalSetup(): Promise<void> {
  if (process.env.TEST_DATABASE_ADMIN_URL) return;

  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (global as unknown as { __MONGO_REPLSET__: MongoMemoryReplSet }).__MONGO_REPLSET__ = replSet;
  process.env.TEST_DATABASE_ADMIN_URL = replSet.getUri();
}
