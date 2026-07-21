import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp, SUPERADMIN } from './utils/test-app';

describe('Auth + RBAC', () => {
  let app: INestApplication;
  let dbName: string;

  beforeAll(async () => {
    ({ app, dbName } = await createTestApp());
  });

  afterAll(async () => {
    await closeTestApp(app, dbName);
  });

  it('logs in the seeded superadmin with correct credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(SUPERADMIN)
      .expect(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('superadmin');
  });

  it('rejects a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: SUPERADMIN.username, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects protected routes with no token', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('serves public routes with no token', async () => {
    const res = await request(app.getHttpServer()).get('/api/public/products').expect(200);
    expect(Array.isArray(res.body.products)).toBe(true);
  });

  it('blocks a worker from a superadmin-only route', async () => {
    const adminLogin = await request(app.getHttpServer()).post('/api/auth/login').send(SUPERADMIN);
    const adminToken = adminLogin.body.token;

    const worker = await request(app.getHttpServer())
      .post('/api/admin/workers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Worker', username: 'rbactestworker', password: 'password123' })
      .expect(201);
    expect(worker.body.worker.username).toBe('rbactestworker');

    const workerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'rbactestworker', password: 'password123' })
      .expect(200);
    const workerToken = workerLogin.body.token;

    // Bulk delete is superadmin-only — a worker token must be refused.
    await request(app.getHttpServer())
      .delete('/api/admin/products')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(403);
  });
});
