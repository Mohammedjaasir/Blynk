import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { categories as categoriesApi, promotions as promotionsApi } from '../api/resources';
import type { AdminProduct, Category, Promotion } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Spinner } from '../components/ui';

interface Summary {
  liveProducts: number;
  hiddenProducts: number;
  unavailableProducts: number;
  categories: Category[];
  promotions: Promotion[];
}

/**
 * An operations summary, not a wall of metric tiles: one line of figures
 * across the top, then only the things that actually need a decision -
 * hidden products, unavailable products, an empty carousel. Every number is
 * counted from the real API.
 */
export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [products, categories, promotions] = await Promise.all([
          apiRequest<{ products: AdminProduct[] }>('/admin/products?limit=200'),
          categoriesApi.listAdmin(),
          promotionsApi.listAdmin(),
        ]);
        if (cancelled) return;
        setSummary({
          liveProducts: products.products.filter((p) => p.is_active).length,
          hiddenProducts: products.products.filter((p) => !p.is_active).length,
          unavailableProducts: products.products.filter(
            (p) => p.is_active && !p.is_available
          ).length,
          categories,
          promotions,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the summary.');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <p className="field__error">{error}</p>
      </>
    );
  }

  if (!summary) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Spinner label="Loading summary" />
      </>
    );
  }

  const activePromotions = summary.promotions.filter((p) => p.is_active);
  const activeCategories = summary.categories.filter((c) => c.is_active);

  const attention: { text: string; to: string; label: string }[] = [];
  if (activePromotions.length === 0) {
    attention.push({
      text: 'No promotion is live, so the Home carousel is hidden.',
      to: '/promotions',
      label: 'Add a promotion',
    });
  }
  if (summary.unavailableProducts > 0) {
    attention.push({
      text: `${summary.unavailableProducts} live ${
        summary.unavailableProducts === 1 ? 'product is' : 'products are'
      } marked unavailable, so customers cannot add ${
        summary.unavailableProducts === 1 ? 'it' : 'them'
      } to a cart.`,
      to: '/products',
      label: 'Review products',
    });
  }
  if (summary.hiddenProducts > 0) {
    attention.push({
      text: `${summary.hiddenProducts} ${
        summary.hiddenProducts === 1 ? 'product is' : 'products are'
      } disabled and out of the customer catalog.`,
      to: '/products',
      label: 'See disabled',
    });
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What customers can see right now."
      />

      <div className="figures">
        <Figure value={summary.liveProducts} label="Live products" to="/products" />
        <Figure
          value={activeCategories.length}
          label="Active categories"
          to="/categories"
        />
        <Figure
          value={activePromotions.length}
          label="Live promotions"
          to="/promotions"
        />
      </div>

      <section className="attention">
        <h2 className="section-label">Needs a look</h2>
        {attention.length === 0 ? (
          <p className="attention__clear">
            Nothing needs attention: the catalog is live and a promotion is
            running.
          </p>
        ) : (
          <ul className="attention__list">
            {attention.map((item) => (
              <li key={item.text} className="attention__item">
                <span>{item.text}</span>
                <Link className="link" to={item.to}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {activePromotions.length > 0 ? (
        <section className="attention">
          <h2 className="section-label">Carousel order</h2>
          <ol className="running-order">
            {activePromotions.map((promotion, index) => (
              <li key={promotion.id}>
                <span className="running-order__index">{index + 1}</span>
                <span className="running-order__title">{promotion.title}</span>
                <span className="running-order__meta">
                  {promotion.cta_label ?? 'Informational'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

function Figure({
  value,
  label,
  to,
}: {
  value: number;
  label: string;
  to: string;
}) {
  return (
    <Link to={to} className="figure">
      <span className="figure__value">{value}</span>
      <span className="figure__label">{label}</span>
    </Link>
  );
}
