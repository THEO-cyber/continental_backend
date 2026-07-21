import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp, SUPERADMIN } from './utils/test-app';

describe('Receipts (math + PDF) and category bulk-delete safety', () => {
  let app: INestApplication;
  let dbFile: string;
  let adminToken: string;
  let auth: { Authorization: string };

  beforeAll(async () => {
    ({ app, dbFile } = await createTestApp());
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(SUPERADMIN);
    adminToken = login.body.token;
    auth = { Authorization: `Bearer ${adminToken}` };
    // A branch must exist before any product can be created.
    await request(app.getHttpServer()).post('/api/admin/branches').set(auth).send({ name: 'Main' });
  });

  afterAll(async () => {
    await closeTestApp(app, dbFile);
  });

  it('computes correct item and receipt totals, and generates a real PDF', async () => {
    const http = app.getHttpServer();
    const p1 = (await request(http).post('/api/admin/products').set(auth)
      .send({ name_en: 'Receipt Test Part A', price: 3000, quantity: 20 })).body.product;
    const p2 = (await request(http).post('/api/admin/products').set(auth)
      .send({ name_en: 'Receipt Test Part B', price: 7000, quantity: 20 })).body.product;

    const receiptRes = await request(http)
      .post('/api/admin/receipts')
      .set(auth)
      .send({
        buyer_type: 'individual',
        buyer_name: 'Jest Test Buyer',
        items: [
          { product_id: p1.id, quantity: 2, unit_price: 3000 },
          { product_id: p2.id, quantity: 1, unit_price: 7000 },
        ],
      })
      .expect(201);
    expect(receiptRes.body.receipt.total).toBe(2 * 3000 + 1 * 7000);
    const receiptId = receiptRes.body.receipt.id;

    const pdfRes = await request(http)
      .get(`/api/admin/receipts/${receiptId}/pdf`)
      .set(auth)
      .expect(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);
  });

  it('bulk delete by category archives products with sale history and hard-deletes the rest', async () => {
    const http = app.getHttpServer();
    const cat = (await request(http).post('/api/admin/categories').set(auth)
      .send({ name_en: 'Bulk Delete Test Category' })).body.category;

    const withSales = (await request(http).post('/api/admin/products').set(auth)
      .send({ name_en: 'Has Sale History', price: 1000, quantity: 10, category: cat.key })).body.product;
    const withoutSales = (await request(http).post('/api/admin/products').set(auth)
      .send({ name_en: 'No Sale History', price: 1000, quantity: 10, category: cat.key })).body.product;

    // Need a worker to record a sale against `withSales`.
    const branchId = (await request(http).get('/api/admin/branches').set(auth)).body.branches[0].id;
    await request(http).post('/api/admin/workers').set(auth)
      .send({ name: 'Cat Test Worker', username: 'cattest.worker', password: 'password123', branch_id: branchId });
    const workerToken = (await request(http).post('/api/auth/login')
      .send({ username: 'cattest.worker', password: 'password123' })).body.token;
    await request(http).post('/api/sales').set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: withSales.id, quantity: 1 }).expect(201);

    const result = await request(http)
      .delete(`/api/admin/products?category=${cat.key}`)
      .set(auth)
      .expect(200);
    expect(result.body.total).toBe(2);
    expect(result.body.archived).toBe(1);
    expect(result.body.deleted).toBe(1);

    const remaining = await request(http)
      .get(`/api/admin/products?category=${cat.key}`)
      .set(auth)
      .expect(200);
    expect(remaining.body.products).toHaveLength(1);
    expect(remaining.body.products[0].id).toBe(withSales.id);
    expect(remaining.body.products[0].published).toBe(0);
    expect(remaining.body.products[0].quantity).toBe(0);

    // The archived (not deleted) product still references this category, so
    // the in-use guard must still refuse to remove the category itself.
    await request(http).delete(`/api/admin/categories/${cat.id}`).set(auth).expect(409);
  });
});
