import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/app.config';
import { hashPassword } from '../common/crypto.util';

const BOOTSTRAP_DDL = [
  `CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL UNIQUE,
    name_en    TEXT NOT NULL,
    name_fr    TEXT NOT NULL DEFAULT '',
    name_zh    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS branches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    city       TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('superadmin','worker')),
    active        INTEGER NOT NULL DEFAULT 1,
    branch_id     INTEGER REFERENCES branches(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT NOT NULL UNIQUE,
    sku           TEXT,
    name_en       TEXT NOT NULL,
    name_fr       TEXT NOT NULL DEFAULT '',
    name_zh       TEXT NOT NULL DEFAULT '',
    desc_en       TEXT NOT NULL DEFAULT '',
    desc_fr       TEXT NOT NULL DEFAULT '',
    desc_zh       TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL DEFAULT 'accessories',
    brand         TEXT NOT NULL DEFAULT '',
    price         INTEGER NOT NULL DEFAULT 0,
    quantity      INTEGER NOT NULL DEFAULT 0,
    image         TEXT NOT NULL DEFAULT '',
    published     INTEGER NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'approved',
    branch_id     INTEGER REFERENCES branches(id),
    created_by_id INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    worker_id  INTEGER NOT NULL REFERENCES users(id),
    quantity   INTEGER NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    sale_date  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_number TEXT NOT NULL UNIQUE,
    buyer_type     TEXT NOT NULL CHECK (buyer_type IN ('company','individual')),
    buyer_name     TEXT NOT NULL,
    buyer_phone    TEXT NOT NULL DEFAULT '',
    buyer_address  TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    subtotal       INTEGER NOT NULL,
    total          INTEGER NOT NULL,
    issued_by_id   INTEGER NOT NULL REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS receipt_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id   INTEGER NOT NULL REFERENCES receipts(id),
    product_id   INTEGER,
    product_name TEXT NOT NULL,
    sku          TEXT NOT NULL DEFAULT '',
    quantity     INTEGER NOT NULL,
    unit_price   INTEGER NOT NULL,
    total        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_date     ON sales(sale_date)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_product  ON sales(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_worker   ON sales(worker_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_pub   ON products(published)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_date  ON receipts(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id)`,
];

// Indexes on columns that may only exist after runColumnMigrations() has run
// (an existing database won't have them yet when BOOTSTRAP_DDL above executes).
const POST_MIGRATION_DDL = [
  `CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)`,
  `CREATE INDEX IF NOT EXISTS idx_products_branch ON products(branch_id)`,
];

// Columns added after the initial release — applied via ALTER TABLE for
// databases created before this version. New databases already get them from
// BOOTSTRAP_DDL above; this is what upgrades an existing one in place.
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'products', column: 'status', ddl: `TEXT NOT NULL DEFAULT 'approved'` },
  { table: 'products', column: 'branch_id', ddl: `INTEGER REFERENCES branches(id)` },
  { table: 'products', column: 'created_by_id', ddl: `INTEGER REFERENCES users(id)` },
  { table: 'users', column: 'branch_id', ddl: `INTEGER REFERENCES branches(id)` },
];

// The 11 categories that already exist in the client-site i18n files and the
// admin UI — seeded once so nothing changes visually; new ones a superadmin
// adds afterward are stored the same way (Admin > Categories).
const DEFAULT_CATEGORIES: Array<{ key: string; nameEn: string; nameFr: string; nameZh: string }> = [
  { key: 'engine', nameEn: 'Engine Parts', nameFr: 'Pièces Moteur', nameZh: '发动机配件' },
  { key: 'brakes', nameEn: 'Braking System', nameFr: 'Système de Freinage', nameZh: '制动系统' },
  { key: 'suspension', nameEn: 'Suspension & Steering', nameFr: 'Suspension & Direction', nameZh: '悬挂与转向' },
  { key: 'transmission', nameEn: 'Transmission', nameFr: 'Transmission', nameZh: '变速箱' },
  { key: 'electrical', nameEn: 'Electrical & Batteries', nameFr: 'Électricité & Batteries', nameZh: '电气与电瓶' },
  { key: 'filters', nameEn: 'Filters', nameFr: 'Filtres', nameZh: '滤清器' },
  { key: 'cooling', nameEn: 'Cooling System', nameFr: 'Système de Refroidissement', nameZh: '冷却系统' },
  { key: 'body', nameEn: 'Body Parts', nameFr: 'Carrosserie', nameZh: '车身件' },
  { key: 'lubricants', nameEn: 'Oils & Lubricants', nameFr: 'Huiles & Lubrifiants', nameZh: '机油与润滑油' },
  { key: 'tires', nameEn: 'Tires & Wheels', nameFr: 'Pneus & Jantes', nameZh: '轮胎与轮毂' },
  { key: 'accessories', nameEn: 'Accessories', nameFr: 'Accessoires', nameZh: '配件用品' },
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  phone: '+237 676 975 012',
  whatsapp: '+237676975012',
  email: 'contofils@gmail.com',
  address: 'B.P. 135, Kribi, Cameroon',
  hours: 'Mon - Sat: 8:00 - 18:00',
  facebook: '',
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfig) {
    super({
      datasources: { db: { url: 'file:' + config.dbFile.replace(/\\/g, '/') } },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // PRAGMAs return a result row, so they must go through $queryRawUnsafe.
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await this.$queryRawUnsafe('PRAGMA foreign_keys = ON');
    for (const ddl of BOOTSTRAP_DDL) await this.$executeRawUnsafe(ddl);
    await this.runColumnMigrations();
    for (const ddl of POST_MIGRATION_DDL) await this.$executeRawUnsafe(ddl);
    await this.seed();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private async runColumnMigrations(): Promise<void> {
    for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
      const existing = await this.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
      if (!existing.some((c) => c.name === column)) {
        await this.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
        this.logger.log(`Migrated: added ${table}.${column}`);
      }
    }
  }

  private async seed(): Promise<void> {
    const admins = await this.user.count({ where: { role: 'superadmin' } });
    if (!admins) {
      await this.user.create({
        data: {
          username: 'admin',
          passwordHash: hashPassword('Continental@2026'),
          name: 'Anyaegbu Chukwuma',
          role: 'superadmin',
          createdAt: this.config.now(),
        },
      });
      this.logger.warn('First run: superadmin created — username "admin", password "Continental@2026". CHANGE IT in Admin > Settings.');
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await this.$executeRawUnsafe('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
    }

    // Ensure at least one branch exists, then backfill any product/worker that
    // predates multi-branch support so nothing is left orphaned.
    const branchCount = await this.$queryRawUnsafe<Array<{ n: number }>>('SELECT COUNT(*) as n FROM branches');
    if (Number(branchCount[0]?.n ?? 0) === 0) {
      await this.$executeRawUnsafe(
        'INSERT INTO branches (name, city, active, created_at) VALUES (?, ?, 1, ?)',
        `${this.config.business.city} Main Branch`, this.config.business.city, this.config.now(),
      );
      this.logger.warn(`First run: default branch "${this.config.business.city} Main Branch" created — add more in Admin > Branches.`);
    }
    const defaultBranch = await this.$queryRawUnsafe<Array<{ id: number }>>('SELECT id FROM branches ORDER BY id ASC LIMIT 1');
    const defaultBranchId = defaultBranch[0].id;
    await this.$executeRawUnsafe('UPDATE products SET branch_id = ? WHERE branch_id IS NULL', defaultBranchId);
    await this.$executeRawUnsafe(`UPDATE products SET status = 'approved' WHERE status IS NULL`);
    await this.$executeRawUnsafe(
      "UPDATE users SET branch_id = ? WHERE branch_id IS NULL AND role = 'worker'",
      defaultBranchId,
    );

    for (const c of DEFAULT_CATEGORIES) {
      await this.$executeRawUnsafe(
        'INSERT OR IGNORE INTO categories (key, name_en, name_fr, name_zh, created_at) VALUES (?, ?, ?, ?, ?)',
        c.key, c.nameEn, c.nameFr, c.nameZh, this.config.now(),
      );
    }
  }
}
