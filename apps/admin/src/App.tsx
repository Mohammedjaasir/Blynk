import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { Cash } from './pages/Cash';
import { Categories } from './pages/Categories';
import { CategoryImport } from './pages/CategoryImport';
import { ArrangeProducts } from './pages/ArrangeProducts';
import { Combos } from './pages/Combos';
import { CategoryGroups } from './pages/CategoryGroups';
import { Coupons } from './pages/Coupons';
import { Referrals } from './pages/Referrals';
import { CustomerDetail, Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { DentalDoctors } from './pages/DentalDoctors';
import { Feedback } from './pages/Feedback';
import { Login } from './pages/Login';
import { Orders } from './pages/Orders';
import { ProductForm } from './pages/ProductForm';
import { ProductImport } from './pages/ProductImport';
import { Products } from './pages/Products';
import { Promotions } from './pages/Promotions';
import { PromoBand } from './pages/PromoBand';
import { HeroBanner } from './pages/HeroBanner';
import { AppTexts } from './pages/AppTexts';
import { QrLinks } from './pages/QrLinks';
import { DailyReport } from './pages/DailyReport';
import { AvailableHours } from './pages/AvailableHours';
import { HomeSections } from './pages/HomeSections';
import { BundleOffers } from './pages/BundleOffers';
import { Sales } from './pages/Sales';
import { OrderMap } from './pages/OrderMap';
import { PurchaseList } from './pages/PurchaseList';
import { ReorderSuggestions } from './pages/ReorderSuggestions';
import { NewPurchaseOrder, PurchaseOrders } from './pages/PurchaseOrders';
import { PurchaseOrderView } from './pages/PurchaseOrderView';
import { Settings } from './pages/Settings';
import { RiderEarnings } from './pages/RiderEarnings';
import { RiderRequests } from './pages/RiderRequests';
import { RiderMap } from './pages/RiderMap';
import { SmsOffers } from './pages/SmsOffers';
import { Notifications } from './pages/Notifications';
import { Staff } from './pages/Staff';
import { Sellers } from './pages/Sellers';
import { SellerDetail } from './pages/SellerDetail';
import { SellerProducts } from './pages/SellerProducts';
import { RepeatBaskets } from './pages/RepeatBaskets';
import { Ratings } from './pages/Ratings';
import { ProductRequests } from './pages/ProductRequests';
import { OrderView } from './pages/OrderView';
import { Expiry } from './pages/Expiry';

/**
 * Route protection here is for the operator's benefit only. Every admin
 * endpoint is guarded server side by requireAuth + requireRoles, so a
 * hand-crafted request from the wrong role is rejected by the API whatever
 * this router does.
 */
function RequireOperations({ children }: { children: JSX.Element }) {
  const { status, retry } = useAuth();
  if (status === 'unreachable') {
    return (
      <div className="boot">
        <p role="status">Could not reach the Blynk API to check your session.</p>
        <button type="button" className="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="boot">
        <Spinner label="Checking your session" />
      </div>
    );
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return children;
}

/** Admin-only screens; packing staff are taken to Orders instead. */
function AdminOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') return <Navigate to="/orders" replace />;
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireOperations>
            <Layout />
          </RequireOperations>
        }
      >
        <Route index element={<AdminOnly><Dashboard /></AdminOnly>} />
        <Route path="orders" element={<Orders />} />
        {/* One order read-only (2026-10-24): Ratings and Repeat baskets link here. */}
        <Route path="orders/:id" element={<AdminOnly><OrderView /></AdminOnly>} />
        <Route path="products" element={<AdminOnly><Products /></AdminOnly>} />
        <Route path="products/new" element={<AdminOnly><ProductForm /></AdminOnly>} />
        <Route path="products/import" element={<AdminOnly><ProductImport /></AdminOnly>} />
        <Route path="products/:id" element={<AdminOnly><ProductForm /></AdminOnly>} />
        <Route path="categories" element={<AdminOnly><Categories /></AdminOnly>} />
        {/* Import categories (owner, 2026-10-14): Main -> Category -> Sub-category. */}
        <Route path="categories/import" element={<AdminOnly><CategoryImport /></AdminOnly>} />
        {/* Arrange (owner, 2026-10-10): a category's product order. */}
        <Route path="categories/:id/arrange" element={<AdminOnly><ArrangeProducts /></AdminOnly>} />
        {/* Seller portal (2026-10-24): approve sellers, their products and prices, record payouts. */}
        <Route path="sellers" element={<AdminOnly><Sellers /></AdminOnly>} />
        <Route path="sellers/:id" element={<AdminOnly><SellerDetail /></AdminOnly>} />
        <Route path="seller-products" element={<AdminOnly><SellerProducts /></AdminOnly>} />
        <Route path="category-groups" element={<AdminOnly><CategoryGroups /></AdminOnly>} />
        <Route path="combos" element={<AdminOnly><Combos /></AdminOnly>} />
        <Route path="promotions" element={<AdminOnly><Promotions /></AdminOnly>} />
        {/* Home promo band (owner, 2026-10-14): the animated band, with a live preview. */}
        <Route path="promo-band" element={<AdminOnly><PromoBand /></AdminOnly>} />
        {/* Home hero banner: the purple banner at the top of Home, with a live preview. */}
        <Route path="home-banner" element={<AdminOnly><HeroBanner /></AdminOnly>} />
        {/* App texts (owner, 2026-10-18): the app's other words and aisle colours. */}
        <Route path="app-texts" element={<AdminOnly><AppTexts /></AdminOnly>} />
        {/* QR links (owner, 2026-10-22): the dynamic QR on a jersey or poster. */}
        <Route path="qr-links" element={<AdminOnly><QrLinks /></AdminOnly>} />
        <Route path="available-hours" element={<AdminOnly><AvailableHours /></AdminOnly>} />
        {/* Daily report (owner, 2026-10-25): the evening SMS - switch, time, numbers, preview, Send now. */}
        <Route path="daily-report" element={<AdminOnly><DailyReport /></AdminOnly>} />
        {/* Home sections (2026-10-24): staff-made product rails on Home, optionally timed with a countdown. */}
        <Route path="home-sections" element={<AdminOnly><HomeSections /></AdminOnly>} />
        {/* Bundle offers (2026-10-25): "buy 2 get 1" and "spend X, get a gift". */}
        <Route path="bundle-offers" element={<AdminOnly><BundleOffers /></AdminOnly>} />
        <Route path="sales" element={<AdminOnly><Sales /></AdminOnly>} />
        {/* Delivery heat map and purchase list (owner, 2026-10-10). */}
        <Route path="order-map" element={<AdminOnly><OrderMap /></AdminOnly>} />
        <Route path="purchase-list" element={<AdminOnly><PurchaseList /></AdminOnly>} />
        {/* Reorder suggestions and supplier purchase orders (2026-10-25, migration 058). */}
        <Route path="reorder-suggestions" element={<AdminOnly><ReorderSuggestions /></AdminOnly>} />
        <Route path="purchase-orders" element={<AdminOnly><PurchaseOrders /></AdminOnly>} />
        <Route path="purchase-orders/new" element={<AdminOnly><NewPurchaseOrder /></AdminOnly>} />
        <Route path="purchase-orders/:id" element={<AdminOnly><PurchaseOrderView /></AdminOnly>} />
        <Route path="cash" element={<AdminOnly><Cash /></AdminOnly>} />
        <Route path="rider-earnings" element={<AdminOnly><RiderEarnings /></AdminOnly>} />
        {/* Rider map (owner, 2026-10-25): riders' positions, waiting orders, Assign here. */}
        <Route path="rider-map" element={<AdminOnly><RiderMap /></AdminOnly>} />
        <Route path="coupons" element={<AdminOnly><Coupons /></AdminOnly>} />
        {/* Refer a friend: every referral (owner, 2026-10-10). */}
        <Route path="referrals" element={<AdminOnly><Referrals /></AdminOnly>} />
        <Route path="customers" element={<AdminOnly><Customers /></AdminOnly>} />
        <Route path="customers/:id" element={<AdminOnly><CustomerDetail /></AdminOnly>} />
        <Route path="sms-offers" element={<AdminOnly><SmsOffers /></AdminOnly>} />
        {/* Push to every customer who allowed notifications (owner, 2026-10-19). */}
        <Route path="notifications" element={<AdminOnly><Notifications /></AdminOnly>} />
        <Route path="feedback" element={<AdminOnly><Feedback /></AdminOnly>} />
        {/* Repeat baskets, ratings + tips, product requests (2026-10-24, migrations 054-056). */}
        <Route path="repeat-baskets" element={<AdminOnly><RepeatBaskets /></AdminOnly>} />
        <Route path="ratings" element={<AdminOnly><Ratings /></AdminOnly>} />
        <Route path="product-requests" element={<AdminOnly><ProductRequests /></AdminOnly>} />
        {/* Expiry dates (2026-10-25, migration 059). */}
        <Route path="expiry" element={<AdminOnly><Expiry /></AdminOnly>} />
        <Route path="dental-doctors" element={<AdminOnly><DentalDoctors /></AdminOnly>} />
        <Route path="staff" element={<AdminOnly><Staff /></AdminOnly>} />
        <Route path="rider-requests" element={<AdminOnly><RiderRequests /></AdminOnly>} />
        <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
