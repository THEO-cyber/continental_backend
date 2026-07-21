import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function resolveRoot(): string {
  // dist/src/config -> backend dir is three levels up from compiled file; be
  // robust whether running from dist or ts-node by locating package.json.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return path.resolve(dir, '..');
    dir = path.dirname(dir);
  }
  return ROOT;
}

@Injectable()
export class AppConfig {
  readonly root = resolveRoot();
  readonly backendDir = path.join(this.root, 'continental_backend');
  readonly dataDir = path.join(this.backendDir, 'data');
  readonly uploadsDir = path.join(this.dataDir, 'uploads');
  readonly clientDir = path.join(this.root, 'continental_client');
  readonly superadminDir = path.join(this.root, 'continental_superadmin');
  readonly workersDir = path.join(this.root, 'continental_workers');
  // DB_FILE lets the e2e test suite point Prisma at a throwaway database
  // instead of the real one; unset in every normal run (dev/prod).
  readonly dbFile = process.env.DB_FILE || path.join(this.dataDir, 'continental.db');

  readonly port = Number(process.env.PORT) || 4000;
  readonly siteUrl = (process.env.SITE_URL || `http://localhost:${Number(process.env.PORT) || 4000}`).replace(/\/+$/, '');
  readonly tokenTtl = '12h';
  readonly timezone = 'Africa/Douala';
  readonly langs = ['en', 'fr', 'zh'] as const;
  readonly defaultLang = 'en';
  readonly lowStockThreshold = 5;
  readonly maxImageBytes = 5 * 1024 * 1024;
  readonly redisUrl = process.env.REDIS_URL || '';

  readonly business = {
    name: 'Continental Auto Parts',
    legalName: 'Continental',
    city: 'Kribi',
    region: 'South Region',
    country: 'Cameroon',
    countryCode: 'CM',
    latitude: 2.9373,
    longitude: 9.9077,
  };

  readonly jwtSecret: string;

  constructor() {
    for (const dir of [this.dataDir, this.uploadsDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    // JWT secret persists across restarts so sessions survive. Never commit data/.
    const secretFile = path.join(this.dataDir, 'secret.key');
    if (process.env.JWT_SECRET) {
      this.jwtSecret = process.env.JWT_SECRET;
    } else if (fs.existsSync(secretFile)) {
      this.jwtSecret = fs.readFileSync(secretFile, 'utf8').trim();
    } else {
      this.jwtSecret = crypto.randomBytes(48).toString('hex');
      fs.writeFileSync(secretFile, this.jwtSecret, { mode: 0o600 });
    }
  }

  /** Today's date (YYYY-MM-DD) in Cameroon local time. */
  todayInCameroon(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone }).format(new Date());
  }

  /** UTC timestamp in the same 'YYYY-MM-DD HH:MM:SS' shape the v1 schema used. */
  now(): string {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
}
