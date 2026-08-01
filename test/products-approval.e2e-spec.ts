import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp, SUPERADMIN } from './utils/test-app';

/**
 * Regression test for a real bug found in production this project: the
 * public product list and the sitemap-data feed checked `published` but not
 * `status`, so a worker's pending submission was publicly visible before
 * superadmin approval. The client site (a separate, Netlify-hosted app) only
 * ever sees products through these endpoints, so they're the whole
 * guarantee now — every one of them must stay blind to a pending product
 * until it's approved.
 */
describe('Worker product submission -> approval workflow', () => {
  let app: INestApplication;
  let dbName: string;
  let adminToken: string;
  let workerToken: string;
  let branchAId: number;
  let branchBId: number;

  beforeAll(async () => {
    ({ app, dbName } = await createTestApp());
    const http = app.getHttpServer();

    const adminLogin = await request(http).post('/api/auth/login').send(SUPERADMIN);
    adminToken = adminLogin.body.token;

    const branchA = await request(http)
      .post('/api/admin/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Kribi Main', city: 'Kribi' });
    branchAId = branchA.body.branch.id;

    const branchB = await request(http)
      .post('/api/admin/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Douala Branch', city: 'Douala' });
    branchBId = branchB.body.branch.id;

    await request(http)
      .post('/api/admin/workers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Branch A Worker', username: 'brancha.worker', password: 'password123', branch_id: branchAId });

    const workerLogin = await request(http)
      .post('/api/auth/login')
      .send({ username: 'brancha.worker', password: 'password123' });
    workerToken = workerLogin.body.token;
  });

  afterAll(async () => {
    await closeTestApp(app, dbName);
  });

  const PRODUCT_NAME = 'Regression Test Turbocharger XYZ';
  let productId: number;
  let productSlug: string;

  it('worker submission lands pending, forced to their own branch (ignoring a spoofed branch_id)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ name_en: PRODUCT_NAME, price: 12000, quantity: 5, branch_id: branchBId })
      .expect(201);
    expect(res.body.product.status).toBe('pending');
    expect(res.body.product.branch_id).toBe(branchAId); // not the spoofed branchBId
    productId = res.body.product.id;
    productSlug = res.body.product.slug;
  });

  it('is invisible on the public API while pending', async () => {
    const res = await request(app.getHttpServer()).get('/api/public/products').expect(200);
    const names = res.body.products.map((p: { name: string }) => p.name);
    expect(names).not.toContain(PRODUCT_NAME);
  });

  it('is invisible on the sitemap-data feed while pending', async () => {
    const res = await request(app.getHttpServer()).get('/api/public/sitemap-data').expect(200);
    const slugs = res.body.products.map((p: { slug: string }) => p.slug);
    expect(slugs).not.toContain(productSlug);
  });

  it('is invisible on the staff catalog while pending', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/staff/products?branchId=all')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    const names = res.body.products.map((p: { name_en: string }) => p.name_en);
    expect(names).not.toContain(PRODUCT_NAME);
  });

  it('becomes visible everywhere once superadmin approves it', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/products/${productId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const pub = await request(app.getHttpServer()).get('/api/public/products').expect(200);
    expect(pub.body.products.map((p: { name: string }) => p.name)).toContain(PRODUCT_NAME);

    const sitemap = await request(app.getHttpServer()).get('/api/public/sitemap-data').expect(200);
    expect(sitemap.body.products.map((p: { slug: string }) => p.slug)).toContain(productSlug);
  });

  it('a rejected product is deleted and never appears anywhere', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ name_en: 'To Be Rejected Part', price: 1000, quantity: 1 })
      .expect(201);
    const id = created.body.product.id;

    await request(app.getHttpServer())
      .post(`/api/admin/products/${id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const res = await request(app.getHttpServer()).get('/api/public/products').expect(200);
    expect(res.body.products.map((p: { name: string }) => p.name)).not.toContain('To Be Rejected Part');
  });
});
