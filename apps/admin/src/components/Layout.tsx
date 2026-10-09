import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { riderApplications } from '../api/resources';
import { useAuth } from '../auth/AuthContext';
import blynkMark from '../assets/blynk-mark.png';
import blynkWordmark from '../assets/blynk-wordmark-light.png';

/**
 * Admin shell: a fixed sidebar and a dense content area. Deliberately not
 * styled like the customer app - this is an internal tool.
 *
 * Scope: the store's order operations (packing, rider assignment - the
 * documented admin/staff dashboard) and, for admins, catalog,
 * customer-facing content and the customer feedback inbox. Inventory and the Rider app are separate
 * applications against the same backend and do not appear here.
 */
export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';
  const { pathname } = useLocation();
  const [pendingRiders, setPendingRiders] = useState(0);

  // Waiting rider applications, refreshed on every page change.
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    riderApplications
      .pendingCount()
      .then((n) => live && setPendingRiders(n))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isAdmin, pathname]);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo" role="img" aria-label="Blynk">
            <img src={blynkMark} alt="" className="sidebar__logo-mark" />
            <img src={blynkWordmark} alt="" className="sidebar__logo-word" />
          </span>
          <span className="sidebar__rule" aria-hidden="true" />
          <span className="sidebar__sub">Admin</span>
        </div>

        <nav className="sidebar__nav">
          {isAdmin ? (
            <NavLink to="/" end className="nav__item">
              Dashboard
            </NavLink>
          ) : null}

          <p className="nav__group">Store</p>
          <NavLink to="/orders" className="nav__item">
            Orders
          </NavLink>

          {isAdmin ? (
            <>
              <NavLink to="/sales" className="nav__item">
                Sales
              </NavLink>
              <NavLink to="/cash" className="nav__item">
                Rider cash
              </NavLink>

              <p className="nav__group">Catalog</p>
              <NavLink to="/products" className="nav__item">
                Products
              </NavLink>
              <NavLink to="/categories" className="nav__item">
                Categories
              </NavLink>
              <NavLink to="/category-groups" className="nav__item">
                Category groups
              </NavLink>

              <p className="nav__group">Home</p>
              <NavLink to="/promotions" className="nav__item">
                Promotions
              </NavLink>
              <NavLink to="/coupons" className="nav__item">
                Coupons
              </NavLink>

              <p className="nav__group">Customers</p>
              <NavLink to="/customers" className="nav__item">
                Customers
              </NavLink>
              <NavLink to="/sms-offers" className="nav__item">
                SMS offers
              </NavLink>
              <NavLink to="/feedback" className="nav__item">
                Feedback
              </NavLink>

              <p className="nav__group">Dental</p>
              <NavLink to="/dental-doctors" className="nav__item">
                Dental doctors
              </NavLink>

              <p className="nav__group">Team</p>
              <NavLink to="/staff" className="nav__item">
                Staff accounts
              </NavLink>
              <NavLink to="/rider-requests" className="nav__item">
                Rider requests
                {pendingRiders > 0 ? (
                  <span className="nav__badge" aria-label={`${pendingRiders} waiting`}>
                    {pendingRiders}
                  </span>
                ) : null}
              </NavLink>

              <p className="nav__group">Store settings</p>
              <NavLink to="/settings" className="nav__item">
                Settings
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="sidebar__footer">
          <p className="sidebar__user">{user?.full_name ?? user?.phone}</p>
          <p className="sidebar__role">{user?.role}</p>
          <button type="button" className="button button--ghost" onClick={() => void handleSignOut()}>
            Log out
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
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
