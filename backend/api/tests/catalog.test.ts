import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

describe('Stage 3 Catalog & Authoritative Pricing Module', () => {
  const app = createApp();

  const adminToken = generateAccessToken({
    id: 'a0000001-0000-0000-0000-000000000003',
    phone: '+94775551122',
    role: 'ADMIN',
  });

  const customerToken = generateAccessToken({
    id: 'a0000001-0000-0000-0000-000000000001',
    phone: '+94771234567',
    role: 'CUSTOMER',
  });

  const riderToken = generateAccessToken({
    id: 'a0000001-0000-0000-0000-000000000002',
    phone: '+94779876543',
    role: 'RIDER',
  });

  afterAll(async () => {
    // Clean up any test categories and products created during testing
    await pool.query(`
      DELETE FROM products WHERE sku LIKE 'TEST-SKU-%';
      DELETE FROM categories WHERE slug LIKE 'test-cat-%';
    `);
  });

  // ==========================================================================
  // 1. CUSTOMER CATEGORIES API
  // ==========================================================================
  describe('Customer Categories API (GET /api/v1/categories)', () => {
    it('returns active categories ordered by display_order ascending', async () => {
      const res = await request(app).get('/api/v1/categories');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.categories)).toBe(true);
      expect(res.body.data.categories.length).toBeGreaterThanOrEqual(2);

      // Verify display_order sorting
      const categories = res.body.data.categories;
      for (let i = 0; i < categories.length - 1; i++) {
        expect(categories[i].display_order).toBeLessThanOrEqual(categories[i + 1].display_order);
      }

      // Check fields exposed to customer: no internal timestamps or internal metadata
      const cat = categories[0];
      expect(cat.id).toBeDefined();
      expect(cat.name).toBeDefined();
      expect(cat.slug).toBeDefined();
      expect(cat).not.toHaveProperty('created_at');
      expect(cat).not.toHaveProperty('updated_at');
    });

    it('excludes inactive categories from customer listing', async () => {
      // 1. Create an inactive category as admin
      const createRes = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Hidden Seasonal Items',
          slug: 'test-cat-hidden-seasonal',
          is_active: false,
        });
      expect(createRes.status).toBe(201);
      const hiddenId = createRes.body.data.category.id;

      // 2. Customer listing must NOT contain the inactive category
      const res = await request(app).get('/api/v1/categories');
      expect(res.status).toBe(200);
      const found = res.body.data.categories.find((c: any) => c.id === hiddenId);
      expect(found).toBeUndefined();
    });
  });

  // ==========================================================================
  // 2. ADMIN CATEGORIES API
  // ==========================================================================
  describe('Admin Categories API (/api/v1/admin/categories)', () => {
    let testCatId: string;

    it('allows ADMIN to create a new category', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Beverages & Soft Drinks',
          slug: 'test-cat-beverages',
          description: 'Carbonated drinks, fruit juices, and iced teas',
          display_order: 10,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.category.name).toBe('Beverages & Soft Drinks');
      expect(res.body.data.category.slug).toBe('test-cat-beverages');
      testCatId = res.body.data.category.id;
    });

    it('rejects duplicate category slug with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Another Beverages',
          slug: 'test-cat-beverages',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CATEGORY_SLUG_EXISTS');
    });

    it('allows ADMIN to update a category', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${testCatId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Beverages & Fruit Juices',
          display_order: 15,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.category.name).toBe('Beverages & Fruit Juices');
      expect(res.body.data.category.display_order).toBe(15);
    });

    it('allows ADMIN to deactivate a category', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${testCatId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          is_active: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.category.is_active).toBe(false);
    });

    it('blocks non-admin users (CUSTOMER, RIDER) with 403 FORBIDDEN', async () => {
      const custRes = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Hacked Cat', slug: 'test-cat-hacked' });
      expect(custRes.status).toBe(403);
      expect(custRes.body.error.code).toBe('FORBIDDEN');

      const riderRes = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ name: 'Hacked Cat', slug: 'test-cat-hacked' });
      expect(riderRes.status).toBe(403);
    });

    it('blocks unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .send({ name: 'No Auth Cat' });
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // 3. CUSTOMER PRODUCTS & PRICING
  // ==========================================================================
  describe('Customer Products & Authoritative Pricing API (GET /api/v1/products)', () => {
    it('lists active products with pagination and authoritative selling prices', async () => {
      const res = await request(app).get('/api/v1/products?limit=10&page=1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.products)).toBe(true);
      expect(res.body.data.products.length).toBeGreaterThanOrEqual(1);

      // Verify pagination object
      const pagination = res.body.data.pagination;
      expect(pagination.page).toBe(1);
      expect(pagination.limit).toBe(10);
      expect(pagination.total).toBeGreaterThanOrEqual(1);
      expect(pagination.total_pages).toBeGreaterThanOrEqual(1);

      // Verify authoritative selling price calculation and sensitive data omission
      const milk = res.body.data.products.find((p: any) => p.sku === 'SKU-DAI-001');
      expect(milk).toBeDefined();
      expect(milk.name).toBe('Kotmale Fresh Milk 1L');
      // Purchase cost is 450.00 LKR with global 20% default markup -> 540.00 LKR
      expect(milk.selling_price).toBe(540.0);

      // CRITICAL: Customer must never receive internal procurement costs or markups
      expect(milk).not.toHaveProperty('purchase_cost');
      expect(milk).not.toHaveProperty('custom_markup_percent');
      expect(milk).not.toHaveProperty('effective_markup_percent');
    });

    it('respects per-product custom markup override (e.g. 15% on Butter, 10% on Eggs)', async () => {
      const res = await request(app).get('/api/v1/products');
      expect(res.status).toBe(200);

      // Butter: Cost 700.00, custom 15% -> 805.00 LKR
      const butter = res.body.data.products.find((p: any) => p.sku === 'SKU-DAI-002');
      expect(butter).toBeDefined();
      expect(butter.selling_price).toBe(805.0);

      // Eggs: Cost 550.00, custom 10% -> 605.00 LKR
      const eggs = res.body.data.products.find((p: any) => p.sku === 'SKU-EGG-003');
      expect(eggs).toBeDefined();
      expect(eggs.selling_price).toBe(605.0);
    });

    it('filters products by category_id', async () => {
      const dairyCategoryId = 'c0000001-0000-0000-0000-000000000001';
      const res = await request(app).get(`/api/v1/products?category_id=${dairyCategoryId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products.length).toBeGreaterThanOrEqual(1);
      res.body.data.products.forEach((p: any) => {
        expect(p.category_id).toBe(dairyCategoryId);
      });
    });

    it('filters products by category_slug', async () => {
      const res = await request(app).get('/api/v1/products?category_slug=biscuits-snacks');

      expect(res.status).toBe(200);
      expect(res.body.data.products.length).toBeGreaterThanOrEqual(1);
      res.body.data.products.forEach((p: any) => {
        expect(p.category_name).toBe('Biscuits & Snacks');
      });
    });

    it('supports safe parameterized search across product names, descriptions, and SKUs', async () => {
      // Search by partial product name
      const res1 = await request(app).get('/api/v1/products?search=Kotmale');
      expect(res1.status).toBe(200);
      expect(res1.body.data.products.length).toBe(1);
      expect(res1.body.data.products[0].sku).toBe('SKU-DAI-001');

      // Search by SKU code
      const res2 = await request(app).get('/api/v1/products?search=SKU-BIS-004');
      expect(res2.status).toBe(200);
      expect(res2.body.data.products.length).toBe(1);
      expect(res2.body.data.products[0].name).toBe('Munchee Super Cream Cracker 490g');

      // Search returning no matches
      const res3 = await request(app).get('/api/v1/products?search=NonExistentSKU999');
      expect(res3.status).toBe(200);
      expect(res3.body.data.products.length).toBe(0);
      expect(res3.body.data.pagination.total).toBe(0);
    });

    it('retrieves single product by UUID (GET /api/v1/products/:id)', async () => {
      const milkId = 'b0000001-0000-0000-0000-000000000001';
      const res = await request(app).get(`/api/v1/products/${milkId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.product.id).toBe(milkId);
      expect(res.body.data.product.name).toBe('Kotmale Fresh Milk 1L');
      expect(res.body.data.product.selling_price).toBe(540.0);
      expect(res.body.data.product).not.toHaveProperty('purchase_cost');
    });

    it('retrieves single product by slug (GET /api/v1/products/:slug)', async () => {
      const res = await request(app).get('/api/v1/products/kotmale-fresh-milk-1l');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.product.sku).toBe('SKU-DAI-001');
    });

    it('returns 404 for non-existent product ID', async () => {
      const res = await request(app).get('/api/v1/products/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('excludes inactive products from customer product list and detail lookup', async () => {
      // 1. Create inactive product via admin
      const adminRes = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category_id: 'c0000001-0000-0000-0000-000000000001',
          name: 'Discontinued Milk Brand',
          slug: 'test-sku-discontinued-milk',
          sku: 'TEST-SKU-DISC-001',
          unit: '1 L',
          purchase_cost: 300.0,
          is_active: false,
        });
      expect(adminRes.status).toBe(201);
      const inactiveProductId = adminRes.body.data.product.id;

      // 2. Listing must not contain it
      const listRes = await request(app).get('/api/v1/products');
      const found = listRes.body.data.products.find((p: any) => p.id === inactiveProductId);
      expect(found).toBeUndefined();

      // 3. Direct lookup must return 404
      const directRes = await request(app).get(`/api/v1/products/${inactiveProductId}`);
      expect(directRes.status).toBe(404);
    });
  });

  // ==========================================================================
  // 4. ADMIN PRODUCT MANAGEMENT
  // ==========================================================================
  describe('Admin Product Management API (/api/v1/admin/products)', () => {
    let createdProductId: string;

    it('allows ADMIN to create a new SKU with base cost and markup override', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category_id: 'c0000001-0000-0000-0000-000000000001',
          name: 'Anchor Full Cream Milk Powder 400g',
          slug: 'test-sku-anchor-milk-powder',
          sku: 'TEST-SKU-ANC-001',
          barcode: '4792024009999',
          unit: '400 g',
          pack_size: 'Foil Box',
          description: 'Premium whole milk powder',
          purchase_cost: 1000.0,
          custom_markup_percent: 25.0, // 25% custom markup -> 1250.00 LKR
          is_available: true,
          is_active: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const prod = res.body.data.product;
      expect(prod.name).toBe('Anchor Full Cream Milk Powder 400g');
      expect(prod.purchase_cost).toBe(1000.0);
      expect(prod.custom_markup_percent).toBe(25.0);
      expect(prod.effective_markup_percent).toBe(25.0);
      expect(prod.calculated_selling_price).toBe(1250.0);
      createdProductId = prod.id;
    });

    it('allows ADMIN to create a SKU without custom markup, defaulting to 20%', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category_id: 'c0000001-0000-0000-0000-000000000001',
          name: 'Highland Fresh Yogurt 80g',
          slug: 'test-sku-highland-yogurt',
          sku: 'TEST-SKU-YOG-002',
          unit: '80 g',
          purchase_cost: 80.0, // 80 LKR + 20% -> 96.00 LKR
        });

      expect(res.status).toBe(201);
      const prod = res.body.data.product;
      expect(prod.custom_markup_percent).toBeNull();
      expect(prod.effective_markup_percent).toBe(20.0);
      expect(prod.calculated_selling_price).toBe(96.0);
    });

    it('rejects product creation with non-existent category_id', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category_id: '00000000-0000-0000-0000-000000000000',
          name: 'Invalid Cat Product',
          sku: 'TEST-SKU-INV-001',
          unit: '1 kg',
          purchase_cost: 100.0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('rejects product creation with duplicate SKU', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category_id: 'c0000001-0000-0000-0000-000000000001',
          name: 'Duplicate SKU Product',
          sku: 'SKU-DAI-001', // Already belongs to Kotmale Milk
          unit: '1 L',
          purchase_cost: 500.0,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PRODUCT_SKU_EXISTS');
    });

    it('allows ADMIN to update price, markup, and availability of an existing product', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${createdProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          purchase_cost: 1100.0,
          custom_markup_percent: 30.0, // 1100 * 1.30 = 1430.00 LKR
          is_available: false,
        });

      expect(res.status).toBe(200);
      const prod = res.body.data.product;
      expect(prod.purchase_cost).toBe(1100.0);
      expect(prod.custom_markup_percent).toBe(30.0);
      expect(prod.effective_markup_percent).toBe(30.0);
      expect(prod.calculated_selling_price).toBe(1430.0);
      expect(prod.is_available).toBe(false);
    });

    it('allows ADMIN to view full product details including procurement cost', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/products/${createdProductId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.product.purchase_cost).toBe(1100.0);
      expect(res.body.data.product.custom_markup_percent).toBe(30.0);
    });

    it('blocks non-admin roles (CUSTOMER, RIDER) from creating or editing products', async () => {
      const custRes = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          category_id: 'c0000001-0000-0000-0000-000000000001',
          name: 'Customer Product Hack',
          sku: 'TEST-SKU-HACK-001',
          unit: '1 kg',
          purchase_cost: 10.0,
        });
      expect(custRes.status).toBe(403);
      expect(custRes.body.error.code).toBe('FORBIDDEN');

      const riderRes = await request(app)
        .patch(`/api/v1/admin/products/${createdProductId}`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ purchase_cost: 1.0 });
      expect(riderRes.status).toBe(403);
    });
  });

  // ==========================================================================
  // 5. PRICING INTEGRITY & TAMPER-RESISTANCE
  // ==========================================================================
  describe('Pricing Integrity & Tamper Resistance', () => {
    it('does not allow customer requests to inject or override selling price, markup, or cost', async () => {
      // If customer requests product listing or detail with bogus query parameters trying to override price
      const res = await request(app)
        .get('/api/v1/products?selling_price=1.00&purchase_cost=0.50&custom_markup_percent=1')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      const milk = res.body.data.products.find((p: any) => p.sku === 'SKU-DAI-001');
      expect(milk.selling_price).toBe(540.0); // Remains authoritative 540 LKR
      expect(milk).not.toHaveProperty('purchase_cost');
    });

    it('verifies numeric rounding behavior for fractional prices', async () => {
      // 333.33 cost with 20% markup = 399.996 -> rounds half-up to 400.00 LKR
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category_id: 'c0000001-0000-0000-0000-000000000001',
          name: 'Fractional Test Item',
          sku: 'TEST-SKU-FRAC-001',
          unit: '1 pc',
          purchase_cost: 333.33,
          custom_markup_percent: 20.0,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.product.calculated_selling_price).toBe(400.0);
    });
  });
});
