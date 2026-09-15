import { Router } from 'express';
import { catalogController } from './catalog.controller.js';

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
productsRouter.get('/:id', catalogController.getProductById.bind(catalogController));

// ----------------------------------------------------------------------------
// 3. ADMIN CATALOG ROUTER
// ----------------------------------------------------------------------------
export const adminCatalogRouter = Router();
adminCatalogRouter.get('/categories', catalogController.getCategoriesAdmin.bind(catalogController));
adminCatalogRouter.post('/categories', catalogController.createCategoryAdmin.bind(catalogController));
adminCatalogRouter.patch('/categories/:id', catalogController.updateCategoryAdmin.bind(catalogController));
adminCatalogRouter.get('/products/:id', catalogController.getProductByIdAdmin.bind(catalogController));
adminCatalogRouter.post('/products', catalogController.createProductAdmin.bind(catalogController));
adminCatalogRouter.patch('/products/:id', catalogController.updateProductAdmin.bind(catalogController));

// ----------------------------------------------------------------------------
// 4. MAIN CATALOG ROUTER (/api/v1/catalog)
// ----------------------------------------------------------------------------
export const catalogRouter = Router();
catalogRouter.get('/status', (_req, res) => {
  res.json({ module: 'catalog', status: 'ready' });
});
catalogRouter.use('/categories', categoriesRouter);
catalogRouter.use('/products', productsRouter);

export * from './catalog.schema.js';
export * from './catalog.repository.js';
export * from './catalog.service.js';
export * from './catalog.controller.js';
