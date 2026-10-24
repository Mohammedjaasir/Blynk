import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSeller } from '../auth/SellerContext';
import markUrl from '../assets/blynk-mark.png';
import { IconBox, IconReceipt, IconSignOut, IconStore, IconTruck } from './icons';
import { ErrorState, PageLoading } from './ui';
import { StatusBanner } from './StatusBanner';

const NAV = [
  { to: '/products', label: 'My products', icon: IconBox },
  { to: '/stock', label: 'Stock', icon: IconTruck },
  { to: '/statement', label: 'Statement', icon: IconReceipt },
  { to: '/shop', label: 'My shop', icon: IconStore },
];

/**
 * The signed-in frame: yellow header with the shop name, the status banner,
 * and a floating tab bar at the bottom on phones (tabs in the header on laptops).
 */
export function Layout() {
  const { signOut } = useAuth();
  const { seller, status, error, reload } = useSeller();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__brand">
            <span className="lockup__tile lockup__tile--small">
              <img src={markUrl} alt="" width={22} height={26} />
            </span>
            <div className="topbar__names">
              <span className="topbar__app">Blynk Sellers</span>
              <span className="topbar__shop">{seller?.shop_name ?? ' '}</span>
            </div>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}>
                <span className="nav__icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <span className="nav__label">{label}</span>
              </NavLink>
            ))}
          </nav>
          <button type="button" className="topbar__out" onClick={() => void signOut()}>
            <IconSignOut size={20} />
            <span className="topbar__out-label">Sign out</span>
          </button>
        </div>
      </header>

      <main className="page">
        {seller ? <StatusBanner seller={seller} /> : null}
        {status === 'loading' ? (
          <PageLoading label="Loading your shop" />
        ) : status === 'error' && !seller ? (
          <ErrorState message={error ?? 'Could not load your shop.'} onRetry={() => void reload()} />
        ) : (
          <div className="page__body">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}
