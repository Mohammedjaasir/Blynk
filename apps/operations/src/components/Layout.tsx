import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BackgroundLocationPrompt } from './BackgroundLocationPrompt';
import { LowStockProvider, useLowStock } from './LowStock';

/**
 * Operations shell: a bottom tab bar, not a desktop sidebar - a deliberate
 * departure from Admin's `Layout.tsx` (plan §8, §23: Operations "must not
 * feel like Admin's dashboard squeezed onto a phone").
 *
 * Tabs, per plan §8: Home, Orders, Delivery, Catalog, More. Catalog is a
 * single grouping entry point for products/categories/promotions/inventory/
 * dental (the plan explicitly leaves the choice between "one grouped entry"
 * and "a More-style expandable area" to the implementer, documented here:
 * grouped under its own top-level tab, matching the plan's own example
 * nav diagram literally). More holds rider list/settings/sign-out.
 *
 * The Delivery tab is always a real, reachable `NavLink` - never removed,
 * never `disabled` in a way that blocks navigation - even when this
 * account has no linked rider profile. It is only marked visually/
 * semantically as unavailable (`aria-disabled`, a "No profile" badge, a
 * `title` tooltip) so the operator gets an honest explanation on the
 * Delivery screen itself rather than a tab that silently does nothing
 * (plan §7: the missing-profile case is "surfaced ... not a new backend
 * concept", not hidden).
 */
const TABS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Home', end: true },
  { to: '/orders', label: 'Orders' },
  { to: '/delivery', label: 'Delivery' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/more', label: 'More' },
];

export function Layout() {
  return (
    <LowStockProvider>
      <Shell />
    </LowStockProvider>
  );
}

/** The Catalog tab (which holds Inventory) carries a count of tracked
 * products that are low or out of stock, from the shared low-stock fetch. */
function Shell() {
  const { user, riderCapability } = useAuth();
  const lowStockTotal = useLowStock().data?.counts.total ?? 0;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="topbar__brand">Blynk Ops</span>
        <span className="topbar__user">{user?.full_name ?? user?.phone}</span>
      </header>

      <main className="content">
        <Outlet />
      </main>
      <BackgroundLocationPrompt />

      <nav className="tabbar" aria-label="Primary">
        {TABS.map((tab) => {
          const disabled = tab.to === '/delivery' && riderCapability === 'ADMIN_ONLY';
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  'tabbar__item',
                  isActive ? 'tabbar__item--active' : '',
                  disabled ? 'tabbar__item--disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
              aria-disabled={disabled || undefined}
              title={disabled ? 'No rider profile is linked to this account' : undefined}
            >
              {tab.label}
              {disabled ? <span className="tabbar__badge">No profile</span> : null}
              {tab.to === '/catalog' && lowStockTotal > 0 ? (
                <span className="tabbar__count" title={`${lowStockTotal} running low`}>
                  {lowStockTotal > 99 ? '99+' : lowStockTotal}
                  <span className="visually-hidden"> running low</span>
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>
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
