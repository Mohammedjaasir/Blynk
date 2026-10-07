import { streamCatalogEvents } from './catalog.events.js';
import { Router } from 'express';
import { catalogController } from './catalog.controller.js';
import { requireAuth, optionalAuth } from '../../middleware/auth.middleware.js';
import { stockAlertController } from './catalog.stock-alerts.js';
import { requireRoles, requireShopper } from '../../middleware/role.middleware.js';
import { categoryGroupsController } from './catalog.groups.js';
import { validate } from '../../middleware/validate.middleware.js';
import { idParamSchema } from './catalog.schema.js';

// A malformed :id is a 400 VALIDATION_ERROR, never a Postgres uuid cast 500.
const validId = validate({ params: idParamSchema });

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
productsRouter.post('/:id/notify-me', requireAuth, requireShopper(), stockAlertController.subscribe);
productsRouter.delete('/:id/notify-me', requireAuth, requireShopper(), stockAlertController.unsubscribe);

// ----------------------------------------------------------------------------
// 3. ADMIN CATALOG ROUTER
// ----------------------------------------------------------------------------
export const adminCatalogRouter = Router();
adminCatalogRouter.get('/categories', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.getCategoriesAdmin.bind(catalogController));
adminCatalogRouter.post('/categories', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.createCategoryAdmin.bind(catalogController));
adminCatalogRouter.patch('/categories/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), validId, catalogController.updateCategoryAdmin.bind(catalogController));
adminCatalogRouter.delete('/categories/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), validId, catalogController.deleteCategoryAdmin.bind(catalogController));
// Category groups on the customer home (migration 025). /order before /:id.
adminCatalogRouter.get('/category-groups', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), categoryGroupsController.list);
adminCatalogRouter.post('/category-groups', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), categoryGroupsController.create);
adminCatalogRouter.put('/category-groups/order', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), categoryGroupsController.reorder);
adminCatalogRouter.patch('/category-groups/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), categoryGroupsController.update);
adminCatalogRouter.delete('/category-groups/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), categoryGroupsController.remove);
adminCatalogRouter.put('/category-groups/:id/categories', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), categoryGroupsController.setCategories);
// Bulk import (.xlsx/.csv parsed in the browser). Before /products/:id.
adminCatalogRouter.post('/products/import', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.importProductsAdmin.bind(catalogController));
adminCatalogRouter.get('/products', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.listProductsAdmin.bind(catalogController));
adminCatalogRouter.get('/products/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), validId, catalogController.getProductByIdAdmin.bind(catalogController));
adminCatalogRouter.post('/products', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), catalogController.createProductAdmin.bind(catalogController));
adminCatalogRouter.patch('/products/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), validId, catalogController.updateProductAdmin.bind(catalogController));
adminCatalogRouter.delete('/products/:id', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), validId, catalogController.deleteProductAdmin.bind(catalogController));

// ----------------------------------------------------------------------------
// 4. MAIN CATALOG ROUTER (/api/v1/catalog)
// ----------------------------------------------------------------------------
export const catalogRouter = Router();
catalogRouter.get('/status', (_req, res) => {
  res.json({ module: 'catalog', status: 'ready' });
});
// Live updates: one Server-Sent Event whenever the catalog changes.
catalogRouter.get('/events', streamCatalogEvents);
// The customer home: groups of category tiles (migration 025).
catalogRouter.get('/home-groups', categoryGroupsController.home);
catalogRouter.use('/categories', categoriesRouter);
catalogRouter.use('/products', productsRouter);

export * from './catalog.schema.js';
export * from './catalog.repository.js';
export * from './catalog.service.js';
export * from './catalog.controller.js';
export * from './catalog.events.js';
export * from './catalog.stock-alerts.js';
export * from './catalog.groups.js';
