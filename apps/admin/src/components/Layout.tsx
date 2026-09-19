import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import blynkMark from '../assets/blynk-mark.png';
import blynkWordmark from '../assets/blynk-wordmark-light.png';

/**
 * Admin shell: a fixed sidebar and a dense content area. Deliberately not
 * styled like the customer app - this is an internal tool.
 *
 * Scope: the store's order operations (packing, rider assignment - the
 * documented admin/staff dashboard) and, for admins, catalog and
 * customer-facing content. Inventory and the Rider app are separate
 * applications against the same backend and do not appear here.
 */
export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';

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
              <p className="nav__group">Catalog</p>
              <NavLink to="/products" className="nav__item">
                Products
              </NavLink>
              <NavLink to="/categories" className="nav__item">
                Categories
              </NavLink>

              <p className="nav__group">Home</p>
              <NavLink to="/promotions" className="nav__item">
                Promotions
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
