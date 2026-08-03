import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp, SUPERADMIN } from './utils/test-app';

/**
 * A product can be stocked under several part numbers, each with its own
 * independent quantity — a worker picks which one a sale comes off of. The
 * riskiest part of this (see sales.service.ts's record()) is that stock for
 * one part number must never be affected by, or borrowable from, another's:
 * that's an atomic, arrayFilters-scoped MongoDB update, not a plain field
 * decrement, so it's worth a dedicated regression test rather than trusting
 * the implementation by inspection alone.
 */
describe('Multiple part numbers per product', () => {
  let app: INestApplication;
  let dbName: string;
  let adminToken: string;
  let workerToken: string;
  let auth: { Authorization: string };
  let productId: string;

  beforeAll(async () => {
    ({ app, dbName } = await createTestApp());
    const http = app.getHttpServer();

    const adminLogin = await request(http).post('/api/auth/login').send(SUPERADMIN);
    adminToken = adminLogin.body.token;
    auth = { Authorization: `Bearer ${adminToken}` };

    await request(http).post('/api/admin/branches').set(auth).send({ name: 'Main' });
    await request(http).post('/api/admin/workers').set(auth)
      .send({ name: 'PN Worker', username: 'pn.worker', password: 'password123' });
    workerToken = (await request(http).post('/api/auth/login')
      .send({ username: 'pn.worker', password: 'password123' })).body.token;

    const created = await request(http).post('/api/admin/products').set(auth).send({
      name_en: 'Multi Part Number Filter',
      part_numbers: [
        { part_number: 'PN-A', quantity: 5, price: 5000 },
        { part_number: 'PN-B', quantity: 3, price: 8000 },
      ],
    });
    productId = created.body.product.id;
  });

  afterAll(async () => {
    await closeTestApp(app, dbName);
  });

  it('a product create requires at least one part number', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set(auth)
      .send({ name_en: 'No Part Numbers', part_numbers: [] });
    expect(res.status).toBe(400);
  });

  it('each part number keeps its own price, exposed as a product-level price_min/price_max range', async () => {
    const product = (await request(app.getHttpServer())
      .get('/api/admin/products')
      .set(auth)).body.products.find((p: { id: string }) => p.id === productId);
    const byPn = Object.fromEntries(
      product.part_numbers.map((pn: { part_number: string; price: number }) => [pn.part_number, pn.price]),
    );
    expect(byPn['PN-A']).toBe(5000);
    expect(byPn['PN-B']).toBe(8000);
    expect(product.price_min).toBe(5000);
    expect(product.price_max).toBe(8000);
  });

  it('selling from one part number leaves the other completely untouched, and uses that part number\'s own price', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: productId, part_number: 'PN-A', quantity: 2 })
      .expect(201);
    expect(res.body.sale.sku).toBe('PN-A');
    expect(res.body.sale.unit_price).toBe(5000); // PN-A's own price, not PN-B's 8000

    const product = (await request(app.getHttpServer())
      .get('/api/admin/products')
      .set(auth)).body.products.find((p: { id: string }) => p.id === productId);
    const byPn = Object.fromEntries(
      product.part_numbers.map((pn: { part_number: string; quantity: number }) => [pn.part_number, pn.quantity]),
    );
    expect(byPn['PN-A']).toBe(3); // 5 - 2
    expect(byPn['PN-B']).toBe(3); // untouched
    expect(product.quantity).toBe(6); // aggregate: 3 + 3
  });

  it('a worker-entered override price is used instead of the part number\'s own price', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: productId, part_number: 'PN-B', quantity: 1, unit_price: 9500 })
      .expect(201);
    expect(res.body.sale.unit_price).toBe(9500); // override, not PN-B's own 8000

    await request(app.getHttpServer()).delete(`/api/sales/${res.body.sale.id}`).set(auth).expect(200);
  });

  it('rejects overselling a part number even though another part number on the same product has spare stock', async () => {
    // PN-B has 3 left; PN-A has 3 left too (combined 6) — selling 4 of PN-B
    // must fail on PN-B's own stock, never "borrow" from PN-A's.
    const res = await request(app.getHttpServer())
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: productId, part_number: 'PN-B', quantity: 4 })
      .expect(409);
    expect(res.body.error).toContain('Only 3 left in stock for part number "PN-B"');

    // Confirm the rejected attempt didn't partially mutate anything.
    const product = (await request(app.getHttpServer())
      .get('/api/admin/products')
      .set(auth)).body.products.find((p: { id: string }) => p.id === productId);
    const byPn = Object.fromEntries(
      product.part_numbers.map((pn: { part_number: string; quantity: number }) => [pn.part_number, pn.quantity]),
    );
    expect(byPn['PN-A']).toBe(3);
    expect(byPn['PN-B']).toBe(3);
  });

  it('rejects selling a part number that does not exist on the product', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: productId, part_number: 'PN-DOES-NOT-EXIST', quantity: 1 })
      .expect(400);
    expect(res.body.error).toContain('PN-DOES-NOT-EXIST');
  });

  it('restocking one part number via PATCH .../stock leaves the other untouched', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/products/${productId}/stock`)
      .set(auth)
      .send({ part_number: 'PN-B', delta: 10 })
      .expect(200);

    const product = (await request(app.getHttpServer())
      .get('/api/admin/products')
      .set(auth)).body.products.find((p: { id: string }) => p.id === productId);
    const byPn = Object.fromEntries(
      product.part_numbers.map((pn: { part_number: string; quantity: number }) => [pn.part_number, pn.quantity]),
    );
    expect(byPn['PN-A']).toBe(3); // untouched
    expect(byPn['PN-B']).toBe(13); // 3 + 10
  });

  it('undoing a sale restores stock to the exact part number it was sold from', async () => {
    const sale = await request(app.getHttpServer())
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ product_id: productId, part_number: 'PN-A', quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/sales/${sale.body.sale.id}`)
      .set(auth)
      .expect(200);

    const product = (await request(app.getHttpServer())
      .get('/api/admin/products')
      .set(auth)).body.products.find((p: { id: string }) => p.id === productId);
    const byPn = Object.fromEntries(
      product.part_numbers.map((pn: { part_number: string; quantity: number }) => [pn.part_number, pn.quantity]),
    );
    expect(byPn['PN-A']).toBe(3); // back to what it was before this sale (3 - 1 + 1)
    expect(byPn['PN-B']).toBe(13); // untouched by the whole undo
  });
});
