import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Cash } from './pages/Cash';
import { Catalog } from './pages/Catalog';
import { Categories } from './pages/Catalog/Categories';
import { CategoryGroups } from './pages/Catalog/CategoryGroups';
import { Combos } from './pages/Catalog/Combos';
import { ProductForm } from './pages/Catalog/ProductForm';
import { ProductImport } from './pages/Catalog/ProductImport';
import { Products } from './pages/Catalog/Products';
import { Promotions } from './pages/Catalog/Promotions';
import { DeliverMyself } from './pages/DeliverMyself';
import { Detail as DeliveryDetail } from './pages/Delivery/Detail';
import { MyDay as DeliveryMyDay } from './pages/Delivery/MyDay';
import { Queue as DeliveryQueue } from './pages/Delivery/Queue';
import { Appointments as DentalAppointments } from './pages/Dental/Appointments';
import { Availability as DentalAvailability } from './pages/Dental/Availability';
import { ClinicDetail as DentalClinicDetail } from './pages/Dental/ClinicDetail';
import { Clinics as DentalClinics } from './pages/Dental/Clinics';
import { Doctors as DentalDoctors } from './pages/Dental/Doctors';
import { DoctorRatings as DentalDoctorRatings } from './pages/Dental/DoctorRatings';
import { Overview as DentalOverview } from './pages/Dental/Overview';
import { Home } from './pages/Home';
import { Ledger as InventoryLedger } from './pages/Inventory/Ledger';
import { Overview as InventoryOverview } from './pages/Inventory/Overview';
import { RunningLow as InventoryRunningLow } from './pages/Inventory/RunningLow';
import { Stock as InventoryStock } from './pages/Inventory/Stock';
import { StockDetail as InventoryStockDetail } from './pages/Inventory/StockDetail';
import { Suppliers as InventorySuppliers } from './pages/Inventory/Suppliers';
import { Login } from './pages/Login';
import { Welcome, hasSeenIntro } from './pages/Welcome';
import { More } from './pages/More';
import { OrderDetail } from './pages/OrderDetail';
import { PackingSlip } from './pages/PackingSlip';
import { Orders } from './pages/Orders';
import { Riders } from './pages/Riders';
import { RiderEarnings } from './pages/RiderEarnings';
import { SmsOffers } from './pages/SmsOffers';
import { RiderRequests } from './pages/RiderRequests';
import { StaffAccounts } from './pages/StaffAccounts';
import { LaunchScreen } from './components/LaunchScreen';
import { AndroidBackButton } from './components/AndroidBackButton';

/**
 * Route protection here is for the operator's benefit only. Every
 * Operations-called endpoint is guarded server side by
 * requireAuth + requireRoles (plus rider ownership on rider-scoped routes),
 * so a hand-crafted request from the wrong role/identity is rejected by the
 * API whatever this router does (common.md rule 8).
 */
function RequireOperations({ children }: { children: JSX.Element }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="boot" role="status">
        Checking your session…
      </div>
    );
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return children;
}

/**
 * ROUTE-TABLE PATTERN - every later Operations task (F2-F9) reads this
 * before adding a route:
 *
 * One flat `<Routes>` block. `/login` is the only route outside the gate.
 * Every other route is a nested child of the single
 * `<Route element={<RequireOperations><Layout/></RequireOperations>}>`
 * wrapper below, so it automatically renders inside the bottom-tab shell
 * and behind the auth gate - never add a second top-level gated block, and
 * never add a route outside this block unless it is genuinely public like
 * `/login`.
 *
 * To add a screen: add one more `<Route path="..." element={<YourPage/>} />`
 * as a sibling inside that same block - a flat leaf for a top-level tab's
 * real content (e.g. `orders`, replacing the `Orders` placeholder in place)
 * or a nested path for a detail/sub-screen (e.g. `orders/:id`,
 * `delivery/:id` - see F2's report for the exact `/delivery/:id` name F4
 * should register). The catch-all `path="*"` always stays last and always
 * redirects to `/` (matching Admin's own convention) - `/`'s own
 * `RequireOperations` gate then sends an unauthenticated visitor on to
 * `/login`, so there is exactly one redirect rule to reason about, not two.
 */
/**
 * The welcome screen opens every launch of the app (owner's request,
 * 2026-09-27): the first navigation of a launch goes to /welcome, carrying
 * where it was headed, and Welcome continues there.
 */
function IntroGate({ children }: { children: JSX.Element }) {
  const location = useLocation();
  const { status } = useAuth();
  // Signed in: straight into the app (owner, 2026-10-08: the welcome showed
  // on every launch even when logged in). It is for signed-out launches only.
  if (status !== 'anonymous') return children;
  if (!hasSeenIntro() && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace state={{ from: location }} />;
  }
  return children;
}

export function AppRoutes() {
  return (
    <IntroGate>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route
        element={
          <RequireOperations>
            <Layout />
          </RequireOperations>
        }
      >
        <Route index element={<Home />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="orders/:id/slip" element={<PackingSlip />} />
        <Route path="delivery" element={<DeliveryQueue />} />
        <Route path="delivery/day" element={<DeliveryMyDay />} />
        <Route path="delivery/:id" element={<DeliveryDetail />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="catalog/products" element={<Products />} />
        <Route path="catalog/products/new" element={<ProductForm />} />
        <Route path="catalog/products/import" element={<ProductImport />} />
        <Route path="catalog/products/:id" element={<ProductForm />} />
        <Route path="catalog/categories" element={<Categories />} />
        <Route path="catalog/category-groups" element={<CategoryGroups />} />
        <Route path="catalog/promotions" element={<Promotions />} />
        <Route path="catalog/combos" element={<Combos />} />
        <Route path="catalog/inventory" element={<InventoryOverview />} />
        <Route path="catalog/inventory/stock" element={<InventoryStock />} />
        <Route path="catalog/inventory/low-stock" element={<InventoryRunningLow />} />
        <Route path="catalog/inventory/stock/:productId" element={<InventoryStockDetail />} />
        <Route path="catalog/inventory/ledger" element={<InventoryLedger />} />
        <Route path="catalog/inventory/suppliers" element={<InventorySuppliers />} />
        <Route path="catalog/dental" element={<DentalOverview />} />
        <Route path="catalog/dental/appointments" element={<DentalAppointments />} />
        <Route path="catalog/dental/clinics" element={<DentalClinics />} />
        <Route path="catalog/dental/clinics/:clinicId" element={<DentalClinicDetail />} />
        <Route path="catalog/dental/clinics/:clinicId/doctors/:clinicDoctorId" element={<DentalAvailability />} />
        <Route path="catalog/dental/doctors" element={<DentalDoctors />} />
        <Route path="catalog/dental/doctors/:doctorId/ratings" element={<DentalDoctorRatings />} />
        <Route path="more" element={<More />} />
        <Route path="more/riders" element={<Riders />} />
        <Route path="more/earnings" element={<RiderEarnings />} />
        <Route path="more/cash" element={<Cash />} />
        <Route path="more/deliver" element={<DeliverMyself />} />
        <Route path="more/staff" element={<StaffAccounts />} />
        <Route path="more/sms-offers" element={<SmsOffers />} />
        <Route path="more/rider-requests" element={<RiderRequests />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </IntroGate>
  );
}

export function App() {
  return (
    <>
      <BrowserRouter>
        <AndroidBackButton />
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
      <LaunchScreen />
    </>
  );
}
