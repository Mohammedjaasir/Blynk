import { apiRequest, tokenStore } from './client';
import type { AppTextsFields, AppTextsSetting } from '../lib/appTexts';
import type { AvailabilityWindow, AvailabilitySetting } from '../lib/availability';
import type { HomeSection, HomeSectionsSetting } from '../lib/homeSections';
import type { BundleOffer, BundleOffersSetting } from '../lib/bundleOffers';
import type { QrLink, QrLinksSetting } from '../lib/qrLinks';
import type { DailyReportDraft, DailyReportPreview, DailyReportSendResult, DailyReportSetting } from '../lib/dailyReport';
import type { LiveRiderMap, RiderAutoAssignSetting } from './types';
import type {
  AdminSeller,
  AdminSubmission,
  CommissionSettings,
  CreateSellerBody,
  PayoutRequest,
  PayoutRequestStatus,
  SellerPayout,
  SellerStatement,
  SellerStatus,
  SubmissionStatus,
} from '../lib/sellers';
import type {
  AppShareLinks,
  AppUpdatePolicySetting,
  AppUpdatesSetting,
  DoctorsAccessSetting,
  PaymentGatewayInput,
  PaymentGatewaySetting,
  PaymentGatewayTestHash,
  RiderTripsSetting,
  DeliverySlotSettings,
  StoreClosureInput,
  StoreHoliday,
  StoreHoursInput,
  StoreSchedule,
  StoreSmsSettings,
  DentalDoctor,
  DentalDoctorInput,
  BoardOrder,
  OrderDetail,
  RiderOption,
  RiderSuggestions,
  AdminProduct,
  SetStockInput,
  SetStockResult,
  StaffVariant,
  VariantDeleteResult,
  AuthUser,
  Category,
  CategoryDeleteResult,
  CategoryGroup,
  CategoryGroupDeleteResult,
  CategoryGroupsOverview,
  Combo,
  ComboInput,
  CustomerProduct,
  DefaultMarkupSetting,
  DeliveryFeeInput,
  DeliveryFeeSetting,
  DeliveryRadiusSetting,
  SmallOrderFeeSetting,
  CheckoutSettings,
  BasketFreeDeliverySetting,
  OrderForSomeoneElseSetting,
  CustomerSmsLanguageMode,
  CustomerSmsLanguageSetting,
  SmsLanguageCode,
  BirthdayOfferSetting,
  BirthdayOfferInput,
  BirthdaysResult,
  ImportResponse,
  ImportRow,
  ProductDeleteResult,
  FeedbackPage,
  FeedbackStatus,
  Paginated,
  Promotion,
  StaffAccount,
  CreateStaffInput,
  UpdateStaffInput,
  StaffRider,
  StaffRiderInput,
  CashHandin,
  CashReconciliation,
  Coupon,
  CouponInput,
  CustomerDetail,
  CustomerExportRow,
  CustomerRow,
  CustomerSort,
  SalesRange,
  SalesReport,
  SmsLanguage,
  SmsOffer,
  SmsOfferEstimate,
  SmsOfferInput,
  SmsOfferSent,
  SmsOfferTestResult,
  RiderApplication,
  RiderApplicationPage,
  RiderApprovalStatus,
  RiderCommissionSetting,
  RiderEarningsRange,
  RiderEarningsReport,
  RiderPay,
  RiderPayInput,
  RiderPaySettings,
  RiderPayModelInput,
  RiderPayBonusesInput,
  RainBoostInput,
  RiderAdjustment,
  RiderAdjustmentInput,
  CategoryProductOrder,
  RemoveImagesPreview,
  RemoveImagesResult,
  RemoveAllProductsPreview,
  RemoveAllProductsResult,
  CategoryImportInput,
  CategoryImportResult,
  CategoryImportTemplate,
  PromoBandFields,
  PromoBandSetting,
  HeroBannerFields,
  HeroBannerSetting,
} from './types';

/**
 * Typed wrappers over the existing Blynk endpoints. No endpoint is invented
 * here: admin catalog routes already existed, promotions and media were
 * added in this phase.
 */

// ---------------------------------------------------------------- auth
export const auth = {
  /** Staff email + password sign-in (backend migration 012). */
  staffLogin: (email: string, password: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  me: () => apiRequest<AuthUser>('/auth/me'),

  // Send the refresh token so the server revokes it: without it the route
  // knows neither the session nor the user, and the session outlives sign-out.
  logout: () =>
    apiRequest('/auth/logout', { method: 'POST', body: tokenStore.refresh ? { refresh_token: tokenStore.refresh } : {} }),
};

// ------------------------------------------------------------ categories
export const categories = {
  listAdmin: (isActive?: boolean) =>
    apiRequest<{ categories: Category[] }>(
      `/admin/categories${isActive === undefined ? '' : `?is_active=${isActive}`}`
    ).then((data) => data.categories),

  create: (input: Partial<Category>) =>
    apiRequest<{ category: Category }>('/admin/categories', {
      method: 'POST',
      body: input as Record<string, unknown>,
    }).then((data) => data.category),

  update: (id: string, input: Partial<Category>) =>
    apiRequest<{ category: Category }>(`/admin/categories/${id}`, {
      method: 'PATCH',
      body: input as Record<string, unknown>,
    }).then((data) => data.category),

  /**
   * A category with products needs a target: 409 CATEGORY_NOT_EMPTY
   * (details.product_count) otherwise. The target goes as a query param.
   */
  remove: (id: string, moveToCategoryId?: string) =>
    apiRequest<CategoryDeleteResult>(
      `/admin/categories/${id}${
        moveToCategoryId ? `?move_to_category_id=${encodeURIComponent(moveToCategoryId)}` : ''
      }`,
      { method: 'DELETE' }
    ),

  /**
   * Category offer (owner, 2026-10-09): % off every product in the category
   * and its sub-categories; replaces any offer it had. 400 OFFER_END_IN_PAST
   * for a changed end that has passed.
   */
  setOffer: (id: string, input: { offer_percent: number; offer_ends_at: string | null }) =>
    apiRequest<{ category: Category }>(`/admin/categories/${id}/offer`, {
      method: 'PUT',
      body: input,
    }).then((data) => data.category),

  removeOffer: (id: string) =>
    apiRequest<{ category: Category }>(`/admin/categories/${id}/offer`, { method: 'DELETE' }).then(
      (data) => data.category
    ),

  /** Arrange (owner, 2026-10-10): one set of siblings (all top level, or
   * one category's sub-categories) in the new order; the server rewrites
   * their display_order 10, 20, 30... Siblings left out keep their order
   * after the listed ones. */
  reorder: (ids: string[]) =>
    apiRequest<{ categories: Array<Pick<Category, 'id' | 'name' | 'display_order'>> }>('/admin/categories/order', {
      method: 'PUT',
      body: { ids },
    }).then((d) => d.categories),

  /** Import categories: the owner's list as text (GET /admin/categories/import/template). */
  importTemplate: () => apiRequest<CategoryImportTemplate>('/admin/categories/import/template'),

  /**
   * Import categories from pasted text or sheet rows. dry_run previews
   * without writing; an apply with errors is 400 CATEGORY_IMPORT_INVALID.
   */
  importCategories: (input: CategoryImportInput, dryRun: boolean) =>
    apiRequest<CategoryImportResult>('/admin/categories/import', {
      method: 'POST',
      body: { ...input, dry_run: dryRun },
    }),

  /** The category's products (its sub-categories' too) in customer order. */
  productOrder: (id: string) => apiRequest<CategoryProductOrder>(`/admin/categories/${id}/product-order`),

  /** Listed products first (1..n); the category's others go back to A-Z after them. */
  setProductOrder: (id: string, productIds: string[]) =>
    apiRequest<CategoryProductOrder>(`/admin/categories/${id}/product-order`, {
      method: 'PUT',
      body: { product_ids: productIds },
    }),
};

// ------------------------------------------------------------ combo packs
/**
 * Combo packs (owner, 2026-10-09; migration 033): products at one lower
 * price. The API refuses a price not below the items' total
 * (400 COMBO_PRICE_NOT_LOWER) and decides what is live.
 */
export const combos = {
  list: () => apiRequest<{ combos: Combo[] }>('/admin/combos').then((d) => d.combos),

  create: (input: ComboInput) =>
    apiRequest<{ combo: Combo }>('/admin/combos', { method: 'POST', body: { ...input } }).then((d) => d.combo),

  /** `items`, when sent, replaces the whole list. */
  update: (id: string, input: Partial<ComboInput>) =>
    apiRequest<{ combo: Combo }>(`/admin/combos/${id}`, { method: 'PATCH', body: { ...input } }).then((d) => d.combo),

  remove: (id: string) => apiRequest<{ id: string; deleted: boolean }>(`/admin/combos/${id}`, { method: 'DELETE' }),
};

// ------------------------------------------------------- category groups
/** The titled rows of category tiles on the customer Home. */
export const categoryGroups = {
  list: () => apiRequest<CategoryGroupsOverview>('/admin/category-groups'),

  create: (input: { name: string; is_active?: boolean }) =>
    apiRequest<{ group: CategoryGroup }>('/admin/category-groups', {
      method: 'POST',
      body: input,
    }).then((data) => data.group),

  update: (id: string, input: { name?: string; is_active?: boolean }) =>
    apiRequest<{ group: CategoryGroup }>(`/admin/category-groups/${id}`, {
      method: 'PATCH',
      body: input,
    }).then((data) => data.group),

  remove: (id: string) =>
    apiRequest<CategoryGroupDeleteResult>(`/admin/category-groups/${id}`, { method: 'DELETE' }),

  /** Must list every live group exactly once (400 otherwise). */
  reorder: (groupIds: string[]) =>
    apiRequest<{ groups: CategoryGroup[] }>('/admin/category-groups/order', {
      method: 'PUT',
      body: { group_ids: groupIds },
    }).then((data) => data.groups),

  /**
   * Sets the group's exact membership AND order: members left out become
   * unassigned; listed categories from another group move in.
   */
  setCategories: (id: string, categoryIds: string[]) =>
    apiRequest<{ group: CategoryGroup }>(`/admin/category-groups/${id}/categories`, {
      method: 'PUT',
      body: { category_ids: categoryIds },
    }).then((data) => data.group),
};

// -------------------------------------------------------------- products
/** The API's largest page of admin products. */
export const PRODUCT_PAGE_SIZE = 200;
/** 50 pages = 10,000 products; past that the list says it is partial. */
export const MAX_PRODUCT_PAGES = 50;

export const products = {
  /** Switch the ticked products hidden / shown (is_active) and greyed out / orderable (is_available) in one call (owner, 2026-10-23). */
  bulkStatus: (ids: string[], change: { is_active?: boolean; is_available?: boolean }) =>
    apiRequest<{ matched: number; changed: number; switched_on: number }>('/admin/products/bulk-status', { method: 'PATCH', body: { ids, ...change } }),
  /**
   * The admin product table reads the customer catalog endpoint for the
   * list (it is the only paginated product listing the backend exposes) and
   * the admin endpoint for a single product's cost/markup fields.
   * `is_available=false` is passed through so inactive-but-available rows
   * are not silently hidden from operators.
   */
  listCustomerView: (params: {
    search?: string;
    category_slug?: string;
    limit?: number;
    page?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.category_slug) query.set('category_slug', params.category_slug);
    query.set('limit', String(params.limit ?? 100));
    query.set('page', String(params.page ?? 1));
    return apiRequest<Paginated<CustomerProduct>>(
      `/catalog/products?${query.toString()}`,
      { auth: false }
    );
  },

  /**
   * Every admin product matching the filters. GET /admin/products returns
   * one page (at most 200) and no total, so this reads page after page until
   * a short page. `complete` is false only if MAX_PRODUCT_PAGES were read and
   * more may remain - the caller says so rather than capping silently.
   */
  listAllAdmin: async (params: { search?: string; category_id?: string; is_active?: boolean } = {}) => {
    const all: AdminProduct[] = [];
    for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
      const query = new URLSearchParams();
      if (params.search) query.set('search', params.search);
      if (params.category_id) query.set('category_id', params.category_id);
      if (params.is_active !== undefined) query.set('is_active', String(params.is_active));
      query.set('limit', String(PRODUCT_PAGE_SIZE));
      query.set('page', String(page));
      const data = await apiRequest<{ products: AdminProduct[] }>(`/admin/products?${query.toString()}`);
      all.push(...data.products);
      if (data.products.length < PRODUCT_PAGE_SIZE) return { products: all, complete: true };
    }
    return { products: all, complete: false };
  },

  /** One page of admin products matching `search` (pickers). */
  searchAdmin: (search: string, limit = 20) => {
    const query = new URLSearchParams({ search, limit: String(limit), page: '1' });
    return apiRequest<{ products: AdminProduct[] }>(`/admin/products?${query.toString()}`).then((d) => d.products);
  },

  getAdmin: (id: string) =>
    apiRequest<{ product: AdminProduct }>(`/admin/products/${id}`).then(
      (data) => data.product
    ),

  create: (input: Record<string, unknown>) =>
    apiRequest<{ product: AdminProduct }>('/admin/products', {
      method: 'POST',
      body: input,
    }).then((data) => data.product),

  update: (id: string, input: Record<string, unknown>) =>
    apiRequest<{ product: AdminProduct }>(`/admin/products/${id}`, {
      method: 'PATCH',
      body: input,
    }).then((data) => data.product),

  /** Hard-deletes a never-ordered product; hides (soft-deletes) one with order history. */
  remove: (id: string) => apiRequest<ProductDeleteResult>(`/admin/products/${id}`, { method: 'DELETE' }),

  /** Remove all product images (ADMIN only): what would be cleared, nothing written. */
  removeImagesPreview: () => apiRequest<RemoveImagesPreview>('/admin/products/remove-images/preview'),

  /** Clears every product and combo image and deletes the unused uploaded files. Cannot be undone. */
  removeAllImages: (confirm: string) =>
    apiRequest<RemoveImagesResult>('/admin/products/remove-images', { method: 'POST', body: { confirm } }),

  /** Remove all products (ADMIN only): what would change, nothing written. */
  removeAllPreview: () => apiRequest<RemoveAllProductsPreview>('/admin/products/remove-all/preview'),

  /** Hides (soft-deletes) every product; orders keep their items. */
  removeAll: (confirm: string, alsoRemoveImages: boolean) =>
    apiRequest<RemoveAllProductsResult>('/admin/products/remove-all', {
      method: 'POST',
      body: { confirm, also_remove_images: alsoRemoveImages },
    }),

  /** Rows parsed in the browser; dry_run validates against the DB without writing. */
  importRows: (rows: ImportRow[], dryRun: boolean) =>
    apiRequest<ImportResponse>('/admin/products/import', {
      method: 'POST',
      body: { rows, dry_run: dryRun },
    }),

  // Variants (migration 045; owner, 2026-10-14): sizes / packs with their own
  // price and stock. Inactive ones are listed too.
  listVariants: (productId: string) =>
    apiRequest<{ variants: StaffVariant[] }>(`/admin/products/${productId}/variants`).then((data) => data.variants),

  /** Create body may carry track_stock / stock_count / low_stock_threshold. */
  createVariant: (productId: string, input: Record<string, unknown>) =>
    apiRequest<{ variant: StaffVariant }>(`/admin/products/${productId}/variants`, {
      method: 'POST',
      body: input,
    }).then((data) => data.variant),

  /** Any subset of the create fields except the stock ones (use inventory.setStock). */
  updateVariant: (productId: string, variantId: string, input: Record<string, unknown>) =>
    apiRequest<{ variant: StaffVariant }>(`/admin/products/${productId}/variants/${variantId}`, {
      method: 'PATCH',
      body: input,
    }).then((data) => data.variant),

  /** Never ordered: removed (HARD); ordered: archived (SOFT). */
  removeVariant: (productId: string, variantId: string) =>
    apiRequest<VariantDeleteResult>(`/admin/products/${productId}/variants/${variantId}`, { method: 'DELETE' }),

  /** Every live variant id once, in the new order. */
  reorderVariants: (productId: string, variantIds: string[]) =>
    apiRequest<{ variants: StaffVariant[] }>(`/admin/products/${productId}/variants/order`, {
      method: 'PUT',
      body: { variant_ids: variantIds },
    }).then((data) => data.variants),
};

// ------------------------------------------------------------- inventory
export const inventory = {
  /**
   * The product form's Stock section in one call (migration 045): tracking,
   * the count and the low-stock level of a product, or of one of its
   * variants with `variant_id`.
   */
  setStock: (productId: string, input: SetStockInput) =>
    apiRequest<SetStockResult>(`/admin/inventory/${productId}/stock`, {
      method: 'PUT',
      body: { ...input },
    }),
};

// -------------------------------------------------------------- settings
export const settings = {
  /** Global default markup (migration 044; owner, 2026-10-13): products with no markup of their own and none on their category. */
  getDefaultMarkup: () => apiRequest<DefaultMarkupSetting>('/admin/settings/default-markup'),

  setDefaultMarkup: (markupPercent: number) =>
    apiRequest<DefaultMarkupSetting>('/admin/settings/default-markup', {
      method: 'PATCH',
      body: { markup_percent: markupPercent },
    }),

  getDeliveryFee: () => apiRequest<DeliveryFeeSetting>('/admin/settings/delivery-fee'),

  /** A number = only the flat fee (the old body); an object = any of fee_lkr / fee_mode / tiers / max_fee_lkr / base_lkr / base_km / per_km_lkr (owner, 2026-10-10, 2026-10-25). */
  setDeliveryFee: (input: number | DeliveryFeeInput) =>
    apiRequest<DeliveryFeeSetting>('/admin/settings/delivery-fee', {
      method: 'PATCH',
      body: typeof input === 'number' ? { fee_lkr: input } : { ...input },
    }),

  getCheckout: () => apiRequest<CheckoutSettings>('/admin/settings/checkout'),

  /** `since` is optional: omitted keeps the stored start (owner, 2026-10-09). */
  setCheckout: (body: {
    coupons_enabled?: boolean;
    show_offer_savings?: boolean;
    new_customer_free_deliveries?: { enabled: boolean; count: number; since?: string };
    /** Owner, 2026-10-12: free delivery above a basket amount. */
    basket_free_delivery?: BasketFreeDeliverySetting;
    /** Owner, 2026-10-12: either switch alone keeps the other. */
    order_for_someone_else?: Partial<OrderForSomeoneElseSetting>;
    /** Owner, 2026-10-25: the small-order fee (switching it on needs migration 063; else 409 SMALL_ORDER_FEE_NOT_READY). */
    small_order_fee?: SmallOrderFeeSetting;
  }) =>
    apiRequest<CheckoutSettings>('/admin/settings/checkout', { method: 'PATCH', body }),

  /** Delivery radius (owner, 2026-10-25): the active store's service radius in km. */
  getDeliveryRadius: () => apiRequest<DeliveryRadiusSetting>('/admin/settings/delivery-radius'),

  setDeliveryRadius: (radiusKm: number) =>
    apiRequest<DeliveryRadiusSetting>('/admin/settings/delivery-radius', { method: 'PATCH', body: { radius_km: radiusKm } }),

  /** Customer SMS language (owner, 2026-10-12): order / sign-in / dental / rider texts. */
  getCustomerSmsLanguage: () => apiRequest<CustomerSmsLanguageSetting>('/admin/settings/customer-sms-language'),

  setCustomerSmsLanguage: (body: { mode?: CustomerSmsLanguageMode; fallback?: SmsLanguageCode }) =>
    apiRequest<CustomerSmsLanguageSetting>('/admin/settings/customer-sms-language', { method: 'PATCH', body }),

  /** Commission riders' default share of the standard delivery fee (owner, 2026-10-09). */
  getRiderCommission: () => apiRequest<RiderCommissionSetting>('/admin/settings/rider-commission'),

  setRiderCommission: (defaultPercent: number) =>
    apiRequest<RiderCommissionSetting>('/admin/settings/rider-commission', {
      method: 'PATCH',
      body: { default_percent: defaultPercent },
    }),

  /**
   * Rider pay controls (owner, 2026-10-10): the store default pay model,
   * automatic bonus rules and the rain boost. Every PATCH returns the whole
   * settings object.
   */
  getRiderPay: () => apiRequest<RiderPaySettings>('/admin/settings/rider-pay'),
  setRiderPayModel: (body: RiderPayModelInput) =>
    apiRequest<RiderPaySettings>('/admin/settings/rider-pay/model', { method: 'PATCH', body: { ...body } }),
  setRiderPayBonuses: (body: RiderPayBonusesInput) =>
    apiRequest<RiderPaySettings>('/admin/settings/rider-pay/bonuses', { method: 'PATCH', body: { ...body } }),
  setRainBoost: (body: RainBoostInput) =>
    apiRequest<RiderPaySettings>('/admin/settings/rider-pay/rain-boost', { method: 'PATCH', body: { ...body } }),

  /** Rider trips (owner, 2026-10-10): orders one rider may carry at once and
   * the max km between drop-offs. PATCH sends only what changed. */
  getRiderTrips: () => apiRequest<RiderTripsSetting>('/admin/settings/rider-trips'),

  /** Automatic rider assignment (owner, 2026-10-25), off by default. PUT sends only what changed. */
  getRiderAutoAssign: () => apiRequest<RiderAutoAssignSetting>('/admin/settings/rider-auto-assign'),

  setRiderAutoAssign: (body: { enabled?: boolean; wait_seconds?: number; max_distance_km?: number }) =>
    apiRequest<RiderAutoAssignSetting>('/admin/settings/rider-auto-assign', { method: 'PUT', body: { ...body } }),

  setRiderTrips: (body: { max_active_deliveries?: number; max_dropoff_distance_km?: number }) =>
    apiRequest<RiderTripsSetting>('/admin/settings/rider-trips', { method: 'PATCH', body: { ...body } }),

  /** Doctors need sign-in (owner, 2026-10-10): guests must log in before
   * the customer app shows doctors. */
  /** In-app updates for Blynk Ops and Blynk Rider (owner, 2026-10-12). Same setting as Operations > More. */
  getAppUpdates: () => apiRequest<AppUpdatesSetting>('/admin/settings/app-updates'),

  setAppUpdates: (body: { ops?: Partial<AppUpdatePolicySetting>; rider?: Partial<AppUpdatePolicySetting> }) =>
    apiRequest<AppUpdatesSetting>('/admin/settings/app-updates', { method: 'PATCH', body }),

  /** Temporary public download link per staff app (owner, 2026-10-12). Audited. */
  getAppShareLinks: () => apiRequest<AppShareLinks>('/admin/settings/app-share-links'),

  setAppShareLink: (body: { app: 'ops' | 'rider'; enabled: boolean; hours?: number }) =>
    apiRequest<AppShareLinks>('/admin/settings/app-share-links', { method: 'PATCH', body }),

  getDoctorsAccess: () => apiRequest<DoctorsAccessSetting>('/admin/settings/doctors-access'),

  setDoctorsAccess: (require_sign_in: boolean) =>
    apiRequest<DoctorsAccessSetting>('/admin/settings/doctors-access', { method: 'PATCH', body: { require_sign_in } }),

  /** Show doctor channelling to customers (owner, 2026-10-14); require_sign_in keeps its value. */
  setDoctorsVisibility: (show_to_customers: boolean) =>
    apiRequest<DoctorsAccessSetting>('/admin/settings/doctors-access', { method: 'PATCH', body: { show_to_customers } }),
  /** PayHere online payments (docs/api/payhere.md section 5). The secret is write-only. */
  getPaymentGateway: () => apiRequest<PaymentGatewaySetting>('/admin/settings/payment-gateway'),
  setPaymentGateway: (body: PaymentGatewayInput) =>
    apiRequest<PaymentGatewaySetting>('/admin/settings/payment-gateway', { method: 'PATCH', body }),
  /** A sample checkout hash from the stored secret; calls nothing outside Blynk. */
  testPaymentHash: (body: { order_id?: string; amount?: number } = {}) =>
    apiRequest<PaymentGatewayTestHash>('/admin/settings/payment-gateway/test-hash', { method: 'POST', body }),

  /** Birthday-week gift and birthday SMS (owner, 2026-10-09). ADMIN and OPERATIONS. */
  getBirthdayOffer: () => apiRequest<BirthdayOfferSetting>('/admin/settings/birthday-offer'),

  setBirthdayOffer: (body: BirthdayOfferInput) =>
    apiRequest<BirthdayOfferSetting>('/admin/settings/birthday-offer', { method: 'PATCH', body: { ...body } }),

  /** Store schedule (owner, 2026-10-10): opening hours, close-now, holidays
   * and delivery slots. Every PATCH returns the whole StoreSchedule. */
  getStoreSchedule: () => apiRequest<StoreSchedule>('/admin/settings/store-schedule'),

  setStoreHours: (body: StoreHoursInput) =>
    apiRequest<StoreSchedule>('/admin/settings/store-hours', { method: 'PATCH', body: { ...body } }),

  setStoreClosure: (body: StoreClosureInput) =>
    apiRequest<StoreSchedule>('/admin/settings/store-closure', { method: 'PATCH', body: { ...body } }),

  /** The full list replaces the stored one. */
  setStoreHolidays: (holidays: StoreHoliday[]) =>
    apiRequest<StoreSchedule>('/admin/settings/store-holidays', { method: 'PATCH', body: { holidays } }),

  setDeliverySlots: (body: Partial<DeliverySlotSettings>) =>
    apiRequest<StoreSchedule>('/admin/settings/delivery-slots', { method: 'PATCH', body: { ...body } }),

  /** (owner, 2026-10-10) "Send offer/birthday texts on closed days". */
  setStoreSms: (body: StoreSmsSettings) =>
    apiRequest<StoreSchedule>('/admin/settings/store-sms', { method: 'PATCH', body: { ...body } }),

  /** Customers whose birthday week is now or within `days` days (0-31). */
  getBirthdays: (days = 7) => apiRequest<BirthdaysResult>(`/admin/birthdays?days=${days}`),
};

// ------------------------------------------------------------ promotions
export const promotions = {
  listAdmin: (isActive?: boolean) =>
    apiRequest<{ promotions: Promotion[] }>(
      `/admin/promotions${isActive === undefined ? '' : `?is_active=${isActive}`}`
    ).then((data) => data.promotions),

  create: (input: Record<string, unknown>) =>
    apiRequest<{ promotion: Promotion }>('/admin/promotions', {
      method: 'POST',
      body: input,
    }).then((data) => data.promotion),

  update: (id: string, input: Record<string, unknown>) =>
    apiRequest<{ promotion: Promotion }>(`/admin/promotions/${id}`, {
      method: 'PATCH',
      body: input,
    }).then((data) => data.promotion),

  reorder: (items: { id: string; display_order: number }[]) =>
    apiRequest<{ promotions: Promotion[] }>('/admin/promotions/reorder', {
      method: 'PATCH',
      body: { items },
    }).then((data) => data.promotions),

  remove: (id: string) =>
    apiRequest(`/admin/promotions/${id}`, { method: 'DELETE' }),

  /** The exact payload the customer Home carousel receives. */
  listCustomerView: () =>
    apiRequest<{ promotions: Promotion[] }>('/promotions', { auth: false }).then(
      (data) => data.promotions
    ),
};

// ------------------------------------------------------------ promo band
/** Home promo band (owner, 2026-10-14): any subset of fields per PATCH. */
export const promoBand = {
  get: () => apiRequest<PromoBandSetting>('/admin/settings/promo-band'),
  update: (body: Partial<PromoBandFields>) =>
    apiRequest<PromoBandSetting>('/admin/settings/promo-band', { method: 'PATCH', body: { ...body } }),
};

// ------------------------------------------------------------ hero banner
/** Home hero banner (the purple banner at the top of Home): any subset of fields per PATCH. */
export const heroBanner = {
  get: () => apiRequest<HeroBannerSetting>('/admin/settings/hero-banner'),
  update: (body: Partial<HeroBannerFields>) =>
    apiRequest<HeroBannerSetting>('/admin/settings/hero-banner', { method: 'PATCH', body: { ...body } }),
};

// ------------------------------------------------------------ app texts
/** The customer app's other words and aisle colours (owner, 2026-10-18); any subset per PATCH. */
export const appTexts = {
  get: () => apiRequest<AppTextsSetting>('/admin/settings/app-texts'),
  update: (body: Partial<AppTextsFields>) =>
    apiRequest<AppTextsSetting>('/admin/settings/app-texts', { method: 'PATCH', body: { ...body } }),
};

// ------------------------------------------------------------ available hours
/** Time-limited products (owner, 2026-10-23): products / categories orderable only between two times; PUT replaces the whole list. */
export const availabilityWindows = {
  get: () => apiRequest<AvailabilitySetting>('/admin/settings/availability-windows'),
  update: (body: { windows: AvailabilityWindow[] }) =>
    apiRequest<AvailabilitySetting>('/admin/settings/availability-windows', { method: 'PUT', body: { ...body } }),
};

// ------------------------------------------------------------ home sections
/** Home sections (owner's brother, 2026-10-24): staff-made product rails on the app's Home; PUT replaces the whole list, in order. */
export const homeSections = {
  get: () => apiRequest<HomeSectionsSetting>('/admin/settings/home-sections'),
  update: (body: { sections: HomeSection[] }) =>
    apiRequest<HomeSectionsSetting>('/admin/settings/home-sections', { method: 'PUT', body: { ...body } }),
};

// ------------------------------------------------------------ bundle offers
/** Bundle offers (owner, 2026-10-25): "buy 2 get 1" / "spend X, get a gift" run inside the order pricing; PUT replaces the whole list. */
export const bundleOffers = {
  get: () => apiRequest<BundleOffersSetting>('/admin/settings/bundle-offers'),
  update: (body: { offers: BundleOffer[] }) =>
    apiRequest<BundleOffersSetting>('/admin/settings/bundle-offers', { method: 'PUT', body: { ...body } }),
};

// ------------------------------------------------------------ QR links
/** QR links (owner, 2026-10-22): the printed code's short address and where it leads; PUT replaces the whole list. */
export const qrLinks = {
  get: () => apiRequest<QrLinksSetting>('/admin/settings/qr-links'),
  update: (body: { links: QrLink[] }) =>
    apiRequest<QrLinksSetting>('/admin/settings/qr-links', { method: 'PUT', body: { ...body } }),
};

// ---------------------------------------------------------------- orders
/** Lanes the Orders board shows (every live and exception state). */
const LIVE_STATUSES = 'PLACED,ITEM_UNAVAILABLE,PACKED,OUT_FOR_DELIVERY,FAILED,CUSTOMER_UNAVAILABLE';

/**
 * Order operations over the existing routes. Each status change is one
 * lifecycle action decided by the API (PATCH /admin/orders/:id/status).
 */
/** The page size the board reads live orders in (the API caps limit at 100). */
export const LIVE_ORDERS_LIMIT = 100;
/** The most pages the board reads in one load (2,000 live orders); past that it says so. */
export const LIVE_ORDERS_MAX_PAGES = 20;

type OrdersPage = { orders: BoardOrder[]; pagination?: { total?: number; total_pages?: number } };

export const orders = {
  /**
   * Every live order, oldest first: the pages are read in sequence until
   * pagination.total_pages (at most LIVE_ORDERS_MAX_PAGES). `total` is the
   * API's count; `truncated` is true only when that bound stopped the read.
   * An order that moved between page reads is kept once.
   */
  live: async () => {
    const read = (page: number) =>
      apiRequest<OrdersPage>(`/admin/orders?status=${LIVE_STATUSES}&limit=${LIVE_ORDERS_LIMIT}&page=${page}`);
    const first = await read(1);
    const total = first.pagination?.total ?? first.orders.length;
    const totalPages = first.pagination?.total_pages ?? 1;
    const all = [...first.orders];
    const last = Math.min(totalPages, LIVE_ORDERS_MAX_PAGES);
    for (let page = 2; page <= last; page += 1) {
      const next = await read(page);
      all.push(...next.orders);
      if (next.orders.length < LIVE_ORDERS_LIMIT) break;
    }
    const seen = new Set<string>();
    const unique = all.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
    return { orders: unique, total, truncated: totalPages > LIVE_ORDERS_MAX_PAGES };
  },

  /**
   * How many orders reached `status` since `since` - pagination.total, so the
   * count is right however many there are (one row is fetched, not all).
   */
  countSince: (status: 'DELIVERED' | 'CANCELLED', since: Date) =>
    apiRequest<OrdersPage>(
      `/admin/orders?status=${status}&since=${encodeURIComponent(since.toISOString())}&limit=1`
    ).then((d) => d.pagination?.total ?? d.orders.length),

  /**
   * Online orders waiting for PayHere (AWAITING_PAYMENT), read apart from the
   * live lanes so an API that does not know the status yet cannot break the
   * board: any refusal reads as "none". Never packable; shown for information.
   */
  awaitingPayment: () =>
    apiRequest<OrdersPage>(`/admin/orders?status=AWAITING_PAYMENT&limit=${LIVE_ORDERS_LIMIT}&page=1`)
      .then((d) => d.orders.filter((o) => o.order_status === 'AWAITING_PAYMENT'))
      .catch(() => [] as BoardOrder[]),

  detail: (id: string) => apiRequest<{ order: OrderDetail }>(`/admin/orders/${id}`).then((d) => d.order),

  setStatus: (id: string, status: string, notes?: string) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: notes === undefined ? { status } : { status, notes },
    }),

  /**
   * Proof of delivery: the customer's 4-digit code, or - only when there is
   * no code - a written override note. The history records which one it was.
   */
  markDelivered: (id: string, proof: { deliveryCode: string } | { notes: string }) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body:
        'deliveryCode' in proof
          ? { status: 'DELIVERED', delivery_code: proof.deliveryCode }
          : { status: 'DELIVERED', notes: proof.notes },
    }),

  /**
   * "Make delivery free" (owner, 2026-10-21): ADMIN and OPERATIONS, open
   * cash-on-delivery orders only. The API sets the fee to 0, works out the
   * total (the cash to collect) again and returns the order.
   */
  waiveDeliveryFee: (id: string, reason?: string) =>
    apiRequest<{ order: OrderDetail }>(`/admin/orders/${id}/waive-delivery-fee`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }).then((d) => d.order),

  /** A pending item the store cannot supply (lifecycle RESOLVE_ITEM). */
  markItemUnavailable: (id: string, itemId: string) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/resolve-item`, {
      method: 'POST',
      body: { item_id: itemId, item_status: 'UNAVAILABLE' },
    }),

  assignRider: (id: string, riderId: string, confirmFarBatch = false) =>
    apiRequest<{ delivery: unknown }>(`/admin/orders/${id}/assign-rider`, {
      method: 'POST',
      // The operator saw that this drop-off is far from the rider's other one.
      body: confirmFarBatch ? { rider_id: riderId, confirm_far_batch: true } : { rider_id: riderId },
    }),
};

export const riders = {
  /** Active riders only (the API filters); no availability flag exists. */
  listActive: () => apiRequest<{ riders: RiderOption[] }>('/admin/riders').then((d) => d.riders),
  /**
   * Every rider profile, inactive ones too (each row's `is_active` says
   * which) - the cash hand-in picker, since a rider switched off may still
   * owe cash.
   */
  listForCash: () => apiRequest<{ riders: RiderOption[] }>('/admin/riders?include_inactive=true').then((d) => d.riders),
  /** The same riders, best first for one order (load, distance to the store, trip). */
  suggestions: (orderId: string) =>
    apiRequest<RiderSuggestions>(`/admin/riders/suggestions?order_id=${encodeURIComponent(orderId)}`),
  /** The Rider map (owner, 2026-10-25): riders' last positions and load, and the orders waiting for a rider. */
  live: () => apiRequest<LiveRiderMap>('/admin/riders/live'),
  /** Company or commission rider, and the rider's own % (owner, 2026-10-09). */
  getPay: (riderId: string) => apiRequest<{ pay: RiderPay }>(`/admin/riders/${riderId}/pay`).then((d) => d.pay),
  setPay: (riderId: string, input: RiderPayInput) =>
    apiRequest<{ pay: RiderPay }>(`/admin/riders/${riderId}/pay`, { method: 'PATCH', body: { ...input } }).then(
      (d) => d.pay
    ),
};

/**
 * Deductions and extra pay for a rider (owner, 2026-10-10). Amounts are
 * signed: negative = deduction, positive = extra pay. Each settles against
 * that day's cash.
 */
export const riderAdjustments = {
  /** `from`/`to` default to today on the server; newest first. */
  list: (filter: { rider_id?: string; from?: string; to?: string } = {}) => {
    const query = new URLSearchParams();
    if (filter.rider_id) query.set('rider_id', filter.rider_id);
    if (filter.from) query.set('from', filter.from);
    if (filter.to) query.set('to', filter.to);
    const qs = query.toString();
    return apiRequest<{ adjustments: RiderAdjustment[] }>(`/admin/rider-adjustments${qs ? `?${qs}` : ''}`).then(
      (d) => d.adjustments
    );
  },
  create: (riderId: string, input: RiderAdjustmentInput) =>
    apiRequest<{ adjustment: RiderAdjustment }>(`/admin/riders/${riderId}/adjustments`, {
      method: 'POST',
      body: { ...input },
    }).then((d) => d.adjustment),
  update: (id: string, input: Partial<RiderAdjustmentInput>) =>
    apiRequest<{ adjustment: RiderAdjustment }>(`/admin/rider-adjustments/${id}`, {
      method: 'PATCH',
      body: { ...input },
    }).then((d) => d.adjustment),
  remove: (id: string) => apiRequest<{ deleted: boolean }>(`/admin/rider-adjustments/${id}`, { method: 'DELETE' }),
};

// -------------------------------------------------------------- feedback
/** Customer feedback sent from the app (backend migration 013). ADMIN only. */
export const feedback = {
  /** Newest first; `status` omitted means every message. */
  list: (params: { status?: FeedbackStatus; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 50));
    return apiRequest<FeedbackPage>(`/admin/feedback?${query.toString()}`);
  },

  setStatus: (id: string, status: FeedbackStatus) =>
    apiRequest<{ feedback: { id: string; status: FeedbackStatus } }>(`/admin/feedback/${id}`, {
      method: 'PATCH',
      body: { status },
    }).then((d) => d.feedback),
};

// ------------------------------------------------------------------ staff
/** Admin / Operations / Inventory / Rider sign-ins (backend migration 014). */
export const staff = {
  list: () => apiRequest<{ staff: StaffAccount[] }>('/admin/staff').then((d) => d.staff),

  create: (input: CreateStaffInput) =>
    apiRequest<{ staff: StaffAccount }>('/admin/staff', { method: 'POST', body: { ...input } }).then((d) => d.staff),

  update: (id: string, input: UpdateStaffInput) =>
    apiRequest<{ staff: StaffAccount }>(`/admin/staff/${id}`, { method: 'PATCH', body: { ...input } }).then(
      (d) => d.staff
    ),

  /** "Can deliver": gives an Operations/Admin account a rider profile, or switches it off. */
  setRider: (id: string, input: StaffRiderInput) =>
    apiRequest<{ rider: StaffRider | null }>(`/admin/staff/${id}/rider`, { method: 'PUT', body: { ...input } }).then(
      (d) => d.rider
    ),
};

// ---------------------------------------------------------------- coupons
/** Coupon codes (backend migration 018). ADMIN and OPERATIONS (owner, 2026-10-10). */
export const coupons = {
  list: () => apiRequest<{ coupons: Coupon[] }>('/admin/coupons').then((d) => d.coupons),

  create: (input: CouponInput) =>
    apiRequest<{ coupon: Coupon }>('/admin/coupons', { method: 'POST', body: { ...input } }).then((d) => d.coupon),

  update: (id: string, input: Partial<CouponInput>) =>
    apiRequest<{ coupon: Coupon }>(`/admin/coupons/${id}`, { method: 'PATCH', body: { ...input } }).then((d) => d.coupon),

  /** Only a coupon nobody has used (409 COUPON_IN_USE otherwise). */
  remove: (id: string) => apiRequest(`/admin/coupons/${id}`, { method: 'DELETE' }),
};

// ------------------------------------------------------------------ sales
/** Daily sales dashboard; ADMIN only. Days are Asia/Colombo. */
export const reports = {
  sales: (range: SalesRange) => apiRequest<SalesReport>(`/admin/reports/sales?range=${range}`),
  /** Per-rider delivery charges, rider/Blynk shares and margin (owner, 2026-10-09). */
  riderEarnings: (range: RiderEarningsRange, custom?: { from: string; to: string }) => {
    const query = new URLSearchParams({ range });
    if (range === 'custom' && custom) {
      query.set('from', custom.from);
      query.set('to', custom.to);
    }
    return apiRequest<RiderEarningsReport>(`/admin/reports/rider-earnings?${query.toString()}`);
  },
};

// -------------------------------------------------------------- customers
/** Customer list and history; ADMIN only (rows carry phone numbers). */
export const customers = {
  list: (params: { search?: string; sort?: CustomerSort; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    query.set('sort', params.sort ?? 'recent');
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 25));
    return apiRequest<{ customers: CustomerRow[]; pagination: Paginated<unknown>['pagination'] }>(`/admin/customers?${query.toString()}`);
  },

  detail: (id: string, page = 1) => apiRequest<CustomerDetail>(`/admin/customers/${id}?page=${page}&limit=20`),

  /** Every customer for the Excel download. */
  exportAll: () => apiRequest<{ customers: CustomerExportRow[] }>('/admin/customers/export'),
};

// ------------------------------------------------------------------- cash
/** Rider cash hand-ins and daily reconciliation (backend migration 019). */
export const cash = {
  reconciliation: (date: string) => apiRequest<CashReconciliation>(`/admin/cash/reconciliation?date=${date}`),

  handins: (date: string) =>
    apiRequest<{ handins: CashHandin[] }>(`/admin/cash/handins?date=${date}`).then((d) => d.handins),

  record: (input: { rider_id: string; amount: number; handin_date: string; note?: string }) =>
    apiRequest<{ handin: CashHandin }>('/admin/cash/handins', { method: 'POST', body: { ...input } }).then(
      (d) => d.handin
    ),

  remove: (id: string) => apiRequest(`/admin/cash/handins/${id}`, { method: 'DELETE' }),
};

// ------------------------------------------------------------- sms offers
/** Offer SMS to registered customers (backend migration 027). ADMIN and OPERATIONS. */
export const smsOffers = {
  /** Who would get it, in which language, and how many SMS parts it costs. */
  estimate: (input: SmsOfferInput) =>
    apiRequest<{ estimate: SmsOfferEstimate }>('/admin/sms-offers/estimate', { method: 'POST', body: { ...input } }).then(
      (d) => d.estimate
    ),

  /** Opening hours only (422 OUTSIDE_SENDING_HOURS; owner, 2026-10-10). */
  send: (input: SmsOfferInput) =>
    apiRequest<{ offer: SmsOfferSent }>('/admin/sms-offers', { method: 'POST', body: { ...input } }).then((d) => d.offer),

  /**
   * To `phone` when given (Sri Lankan mobile), else the signed-in staff
   * member's own phone; admins have none, so they enter one (400 NO_TEST_PHONE).
   */
  test: (language: SmsLanguage, message: string, phone?: string) =>
    apiRequest<SmsOfferTestResult>('/admin/sms-offers/test', {
      method: 'POST',
      body: phone ? { language, message, phone } : { language, message },
    }),

  /** Newest first. */
  list: () => apiRequest<{ offers: SmsOffer[] }>('/admin/sms-offers').then((d) => d.offers),
};

/** Rider applications from the Rider app, reviewed by Admin or Operations. */
export const riderApplications = {
  list: (status: RiderApprovalStatus, page = 1, limit = 50) =>
    apiRequest<RiderApplicationPage>(`/admin/rider-applications?status=${status}&page=${page}&limit=${limit}`),
  pendingCount: () => apiRequest<{ pending: number }>('/admin/rider-applications/count').then((d) => d.pending),
  /** `pay` picks company or commission rider (owner, 2026-10-09); without it the API makes a company rider. */
  approve: (id: string, pay?: RiderPayInput) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${id}/approve`, {
      method: 'POST',
      ...(pay ? { body: { ...pay } } : {}),
    }).then((d) => d.application),
  reject: (id: string, reason: string) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }).then((d) => d.application),
};

// Dental doctors (owner, 2026-10-09): list, add and edit (also the
// activate/deactivate switch). No delete endpoint - deactivate instead.
export const dentalDoctors = {
  list: () => apiRequest<{ doctors: DentalDoctor[] }>('/admin/dental/doctors').then((d) => d.doctors),
  create: (input: DentalDoctorInput) =>
    apiRequest<{ doctor: DentalDoctor }>('/admin/dental/doctors', { method: 'POST', body: { ...input } }).then(
      (d) => d.doctor
    ),
  update: (id: string, input: DentalDoctorInput) =>
    apiRequest<{ doctor: DentalDoctor }>(`/admin/dental/doctors/${id}`, { method: 'PATCH', body: { ...input } }).then(
      (d) => d.doctor
    ),
};

// ------------------------------------------------------------ sellers
/** Sellers and their product submissions (seller portal, 2026-10-24). Admin approves sellers, products and prices; payouts are a manual ledger. */
export const sellers = {
  list: (params: { status?: SellerStatus; search?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    const qs = query.toString();
    return apiRequest<{ sellers: AdminSeller[] }>(`/admin/sellers${qs ? `?${qs}` : ''}`).then((d) => d.sellers);
  },
  get: (id: string) => apiRequest<{ seller: AdminSeller; statement: SellerStatement }>(`/admin/sellers/${id}`),
  /** Sellers are invite-only (2026-10-24): staff add each shop with the phone it signs in with. 409 PHONE_IN_USE when the number has an account. */
  create: (body: CreateSellerBody) =>
    apiRequest<{ seller: AdminSeller }>('/admin/sellers', { method: 'POST', body: { ...body } }).then((d) => d.seller),
  /** Approve / reject (reason needed) / suspend, the commission percent (null = category rates), the sign-in phone and contact details. */
  update: (
    id: string,
    body: {
      status?: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
      rejection_reason?: string;
      commission_percent?: number | null;
      phone?: string;
      shop_name?: string;
      contact_name?: string | null;
      address?: string | null;
      note?: string | null;
    }
  ) =>
    apiRequest<{ seller: AdminSeller }>(`/admin/sellers/${id}`, { method: 'PATCH', body: { ...body } }).then((d) => d.seller),
  recordPayout: (id: string, body: { amount: number; note?: string; paid_on?: string }) =>
    apiRequest<{ payout: SellerPayout; statement: SellerStatement }>(`/admin/sellers/${id}/payouts`, { method: 'POST', body: { ...body } }),
  deletePayout: (id: string, payoutId: string) =>
    apiRequest<{ statement: SellerStatement }>(`/admin/sellers/${id}/payouts/${payoutId}`, { method: 'DELETE' }).then((d) => d.statement),
  /** The seller's waiting shop pin becomes the one in use (migration 053). */
  approveLocation: (id: string) =>
    apiRequest<{ seller: AdminSeller }>(`/admin/sellers/${id}/location/approve`, { method: 'POST', body: {} }).then((d) => d.seller),
  rejectLocation: (id: string, reason: string) =>
    apiRequest<{ seller: AdminSeller }>(`/admin/sellers/${id}/location/reject`, { method: 'POST', body: { reason } }).then((d) => d.seller),
};

export const sellerSubmissions = {
  /** Oldest first. The API defaults to PENDING. */
  list: (params: { status?: SubmissionStatus; seller_id?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.seller_id) query.set('seller_id', params.seller_id);
    const qs = query.toString();
    return apiRequest<{ submissions: AdminSubmission[] }>(`/admin/seller-submissions${qs ? `?${qs}` : ''}`).then((d) => d.submissions ?? []);
  },
  /** Waiting submissions, for the nav badge. */
  pendingCount: () => sellerSubmissions.list({ status: 'PENDING' }).then((rows) => rows.length),
  approve: (id: string, body: { selling_price?: number; category_id?: string }) =>
    apiRequest<{ submission: AdminSubmission; product: AdminProduct }>(`/admin/seller-submissions/${id}/approve`, { method: 'POST', body: { ...body } }),
  reject: (id: string, reason: string) =>
    apiRequest<{ submission: AdminSubmission }>(`/admin/seller-submissions/${id}/reject`, { method: 'POST', body: { reason } }).then((d) => d.submission),
};

const sellerQuery = (params: { status?: string; seller_id?: string }) => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.seller_id) query.set('seller_id', params.seller_id);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
};

/** Sellers asking to be paid (migration 057). Paying records the payout (the same ledger as "Record payment"). */
export const sellerPayoutRequests = {
  /** REQUESTED (waiting, oldest first) unless asked; ALL = every status. */
  list: (params: { status?: PayoutRequestStatus | 'ALL'; seller_id?: string } = {}) =>
    apiRequest<{ payout_requests: PayoutRequest[] }>(`/admin/seller-payout-requests${sellerQuery(params)}`).then((d) => d.payout_requests ?? []),
  pay: (id: string, body: { paid_on?: string; note?: string } = {}) =>
    apiRequest<{ payout_request: PayoutRequest; payout: SellerPayout; statement: SellerStatement }>(`/admin/seller-payout-requests/${id}/pay`, {
      method: 'POST',
      body: { ...body },
    }),
  decline: (id: string, reason: string) =>
    apiRequest<{ payout_request: PayoutRequest }>(`/admin/seller-payout-requests/${id}/decline`, { method: 'POST', body: { reason } }).then(
      (d) => d.payout_request
    ),
};

/** What Blynk keeps from seller sales: a default %, optional per-category rates (a sub-category falls back to its main one); a seller's own rate beats both. */
export const sellerCommission = {
  get: () => apiRequest<CommissionSettings>('/admin/settings/seller-commission'),
  save: (body: { default_percent: number; categories: { category_id: string; percent: number | null }[] }) =>
    apiRequest<CommissionSettings>('/admin/settings/seller-commission', { method: 'PUT', body: { ...body } }),
};

// ------------------------------------------------------------ daily report
/** The evening report SMS (owner, 2026-10-25): setting, today-so-far preview and Send now (2-minute cooldown). */
export const dailyReport = {
  get: () => apiRequest<DailyReportSetting>('/admin/settings/daily-report'),
  update: (body: Partial<DailyReportDraft>) => apiRequest<DailyReportSetting>('/admin/settings/daily-report', { method: 'PUT', body: { ...body } }),
  preview: () => apiRequest<DailyReportPreview>('/admin/daily-report/preview', { method: 'POST', body: {} }),
  sendNow: () => apiRequest<DailyReportSendResult>('/admin/daily-report/send-now', { method: 'POST', body: {} }),
};
