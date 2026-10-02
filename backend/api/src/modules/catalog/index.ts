import { streamCatalogEvents } from './catalog.events.js';
import { Router } from 'express';
import { catalogController } from './catalog.controller.js';
import { requireAuth, optionalAuth } from '../../middleware/auth.middleware.js';
import { stockAlertController } from './catalog.stock-alerts.js';
import { requireRoles } from '../../middleware/role.middleware.js';

// ----------------------------------------------------------------------------
// 1. CUSTOMER CATEGORIES ROUTER (/api/v1/categories)
// ----------------------------------------------------------------------------
export const categoriesRouter = Router();
categoriesRouter.get('/', catalogController.getCategories.bind(catalogController));

// ----------------------------------------------------------------------------
// 2. CUSTOMER PRODUCTS ROUTER (/api/v1/products)
// ----------------------------------------------------------------------------
export const productsRouter = Router();
productsRouter.get('/', catalogController.getProducts.bind(catalogController));
productsRouter.get('/:id', optionalAuth, catalogController.getProductById.bind(catalogController));
// "Notify me when it's back" on a sold-out product (phase 6), customers only.
productsRouter.post('/:id/notify-me', requireAuth, requireRoles(['CUSTOMER']), stockAlertController.subscribe);
productsRouter.delete('/:id/notify-me', requireAuth, requireRoles(['CUSTOMER']), stockAlertController.unsubscribe);

// ----------------------------------------------------------------------------
// 3. ADMIN CATALOG ROUTER
// ----------------------------------------------------------------------------
export const adminCatalogRouter = Router();
adminCatalogRouter.get('/categories', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.getCategoriesAdmin.bind(catalogController));
adminCatalogRouter.post('/categories', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.createCategoryAdmin.bind(catalogController));
adminCatalogRouter.patch('/categories/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.updateCategoryAdmin.bind(catalogController));
adminCatalogRouter.delete('/categories/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.deleteCategoryAdmin.bind(catalogController));
// Bulk import (.xlsx/.csv parsed in the browser). Before /products/:id.
adminCatalogRouter.post('/products/import', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.importProductsAdmin.bind(catalogController));
adminCatalogRouter.get('/products', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.listProductsAdmin.bind(catalogController));
adminCatalogRouter.get('/products/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.getProductByIdAdmin.bind(catalogController));
adminCatalogRouter.post('/products', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.createProductAdmin.bind(catalogController));
adminCatalogRouter.patch('/products/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.updateProductAdmin.bind(catalogController));
adminCatalogRouter.delete('/products/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.deleteProductAdmin.bind(catalogController));

// ----------------------------------------------------------------------------
// 4. MAIN CATALOG ROUTER (/api/v1/catalog)
// ----------------------------------------------------------------------------
export const catalogRouter = Router();
catalogRouter.get('/status', (_req, res) => {
  res.json({ module: 'catalog', status: 'ready' });
});
// Live updates: one Server-Sent Event whenever the catalog changes.
catalogRouter.get('/events', streamCatalogEvents);
catalogRouter.use('/categories', categoriesRouter);
catalogRouter.use('/products', productsRouter);

export * from './catalog.schema.js';
export * from './catalog.repository.js';
export * from './catalog.service.js';
export * from './catalog.controller.js';
export * from './catalog.events.js';
export * from './catalog.stock-alerts.js';
