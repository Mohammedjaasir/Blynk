import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSeller } from '../auth/SellerContext';
import markUrl from '../assets/blynk-mark.png';
import { ErrorState, PageLoading } from './ui';
import { StatusBanner } from './StatusBanner';

const NAV = [
  { to: '/products', label: 'My products' },
  { to: '/statement', label: 'Statement' },
  { to: '/shop', label: 'My shop' },
];

/**
 * The signed-in frame: yellow header with the shop name, the status banner,
 * and a bottom tab bar on phones (a top bar on laptops).
 */
export function Layout() {
  const { signOut } = useAuth();
  const { seller, status, error, reload } = useSeller();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__brand">
            <img src={markUrl} alt="" width={26} height={31} />
            <div className="topbar__names">
              <span className="topbar__app">Blynk Sellers</span>
              <span className="topbar__shop">{seller?.shop_name ?? ' '}</span>
            </div>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button type="button" className="button button--ink topbar__out" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {seller ? <StatusBanner seller={seller} /> : null}

      <main className="page">
        {status === 'loading' ? (
          <PageLoading label="Loading your shop" />
        ) : status === 'error' && !seller ? (
          <ErrorState message={error ?? 'Could not load your shop.'} onRetry={() => void reload()} />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
