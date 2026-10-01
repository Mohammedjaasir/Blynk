import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { stockApi } from '../api/resources';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../auth/can';
import blynkMark from '../assets/blynk-mark.png';
import blynkWordmark from '../assets/blynk-wordmark-light.png';
import { STOCK_CHANGED_EVENT } from '../lib/stock';
import { useLoad } from '../lib/useLoad';

/**
 * Inventory shell. Navigation is exactly the Inventory application's scope:
 * stock and sourcing. Products, categories and promotions live in Admin;
 * riders, deliveries and customers are other applications.
 */
export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The "Running low" count refreshes on every page change and whenever
  // stock is changed in this app. A failed load just hides the badge.
  const lowStock = useLoad(() => stockApi.lowStock(), [pathname]);
  const reloadLowStock = lowStock.reload;
  useEffect(() => {
    const onChange = () => void reloadLowStock();
    window.addEventListener(STOCK_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(STOCK_CHANGED_EVENT, onChange);
  }, [reloadLowStock]);
  const counts = lowStock.data?.counts;

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo" role="img" aria-label="Blynk">
            <img src={blynkMark} alt="" className="sidebar__logo-mark" />
            <img src={blynkWordmark} alt="" className="sidebar__logo-word" />
          </span>
          <span className="sidebar__app">Inventory</span>
        </div>

        <nav className="sidebar__nav" aria-label="Inventory">
          <NavLink to="/" end className="nav__item">
            Overview
          </NavLink>
          <p className="nav__group">Stock</p>
          <NavLink to="/stock" className="nav__item">
            Inventory
          </NavLink>
          <NavLink to="/low-stock" className="nav__item">
            Running low
            {counts && counts.total > 0 ? <LowStockBadge out={counts.out} low={counts.low} /> : null}
          </NavLink>
          <NavLink to="/ledger" className="nav__item">
            Ledger
          </NavLink>
          <p className="nav__group">Sourcing</p>
          <NavLink to="/sourcing" className="nav__item">
            Sourcing queue
          </NavLink>
          <NavLink to="/suppliers" className="nav__item">
            Suppliers
          </NavLink>
        </nav>

        <div className="sidebar__user">
          <span className="sidebar__user-name">{user?.full_name ?? user?.phone}</span>
          <span className="sidebar__user-role">{user ? ROLE_LABEL[user.role] : ''}</span>
          <button type="button" className="sidebar__signout" onClick={() => void handleSignOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Count of products needing stock. Dark when anything is fully out, yellow
 * when only low; the hidden text spells out the split so colour never
 * carries it alone.
 */
function LowStockBadge({ out, low }: { out: number; low: number }) {
  const parts = [out > 0 ? `${out} out of stock` : null, low > 0 ? `${low} low` : null].filter(Boolean).join(', ');
  return (
    <span className={`nav__badge${out > 0 ? ' nav__badge--out' : ''}`} title={parts}>
      <span aria-hidden="true">{out + low}</span>
      <span className="sr-only">: {parts}</span>
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
