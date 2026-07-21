import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp, SUPERADMIN } from './utils/test-app';

describe('Sales recording + branch scoping', () => {
  let app: INestApplication;
  let dbName: string;
  let adminToken: string;
  let workerToken: string;
  let branchAId: number;
  let branchBId: number;
  let productAId: number;
  let productBId: number;

  beforeAll(async () => {
    ({ app, dbName } = await createTestApp());
    const http = app.getHttpServer();

    const adminLogin = await request(http).post('/api/auth/login').send(SUPERADMIN);
    adminToken = adminLogin.body.token;
    const auth = { Authorization: `Bearer ${adminToken}` };

    branchAId = (await request(http).post('/api/admin/branches').set(auth).send({ name: 'Branch A' })).body.branch.id;
    branchBId = (await request(http).post('/api/admin/branches').set(auth).send({ name: 'Branch B' })).body.branch.id;

    await request(http).post('/api/admin/workers').set(auth)
      .send({ name: 'Sales Worker', username: 'sales.worker', password: 'password123', branch_id: branchAId });
    workerToken = (await request(http).post('/api/auth/login')
      .send({ username: 'sales.worker', password: 'password123' })).body.token;

    productAId = (await request(http).post('/api/admin/products').set(auth)
      .send({ name_en: 'Branch A Only Part', price: 5000, quantity: 10, branch_id: branchAId })).body.product.id;
    productBId = (await request(http).post('/api/admin/products').set(auth)
      .send({ name_en: 'Branch B Only Part', price: 8000, quantity: 4, branch_id: branchBId })).body.product.id;
  });

  afterAll(async () => {
    await closeTestApp(app, dbName);
  });

  it('records a sale with a worker-entered override price and decrements stock', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: productAId, quantity: 3, unit_price: 4500 })
      .expect(201);
    expect(res.body.sale.total).toBe(3 * 4500);
    expect(res.body.sale.unit_price).toBe(4500);

    const staff = await request(app.getHttpServer())
      .get('/api/staff/products')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    const product = staff.body.products.find((p: { id: number }) => p.id === productAId);
    expect(product.quantity).toBe(7); // 10 - 3
  });

  it('never oversells — rejects a sale larger than remaining stock', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: productAId, quantity: 999 })
      .expect(409);
    expect(res.body.error).toContain('7 left in stock');

    const staff = await request(app.getHttpServer())
      .get('/api/staff/products')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    const product = staff.body.products.find((p: { id: number }) => p.id === productAId);
    expect(product.quantity).toBe(7); // unchanged
  });

  it('scopes the staff catalog to the worker\'s own branch by default', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/staff/products')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    const ids = res.body.products.map((p: { id: number }) => p.id);
    expect(ids).toContain(productAId);
    expect(ids).not.toContain(productBId);
  });

  it('lets a worker search other branches explicitly', async () => {
    const all = await request(app.getHttpServer())
      .get('/api/staff/products?branchId=all')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    const allIds = all.body.products.map((p: { id: number }) => p.id);
    expect(allIds).toEqual(expect.arrayContaining([productAId, productBId]));

    const onlyB = await request(app.getHttpServer())
      .get(`/api/staff/products?branchId=${branchBId}`)
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    const onlyBIds = onlyB.body.products.map((p: { id: number }) => p.id);
    expect(onlyBIds).toContain(productBId);
    expect(onlyBIds).not.toContain(productAId);
  });

  it('never exposes price or exact quantity on the public catalog', async () => {
    const res = await request(app.getHttpServer()).get('/api/public/products').expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('"price"');
    expect(body).not.toContain('"quantity"');
  });
});
