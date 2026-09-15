import { Router } from 'express';

export const pricingRouter = Router();

export interface PriceCalculationParams {
  purchaseCost: number;
  customMarkupPercent?: number | null;
  defaultMarkupPercent?: number;
}

export interface CalculatedPriceResult {
  purchaseCost: number;
  effectiveMarkupPercent: number;
  sellingPrice: number;
}

/**
 * Helper to determine effective markup percentage.
 * Uses customMarkupPercent if provided (and non-null/valid), otherwise defaults to defaultMarkupPercent (20%).
 */
export function getEffectiveMarkupPercent(
  customMarkupPercent?: number | null,
  defaultMarkupPercent: number = 20.0
): number {
  if (
    customMarkupPercent !== undefined &&
    customMarkupPercent !== null &&
    !isNaN(Number(customMarkupPercent))
  ) {
    return Number(customMarkupPercent);
  }
  return defaultMarkupPercent;
}

/**
 * Authoritative selling price calculator.
 * Enforces business rule: selling_price = purchase_cost * (1 + effective_markup / 100).
 * Rounded to 2 decimal places for LKR.
 */
export function calculateSellingPrice(params: PriceCalculationParams): CalculatedPriceResult {
  const { purchaseCost, customMarkupPercent, defaultMarkupPercent = 20.0 } = params;

  const cost = Number(purchaseCost);
  if (isNaN(cost) || cost < 0) {
    throw new Error('Purchase cost cannot be negative');
  }

  const effectiveMarkupPercent = getEffectiveMarkupPercent(customMarkupPercent, defaultMarkupPercent);

  if (effectiveMarkupPercent < 0) {
    throw new Error('Markup percentage cannot be negative');
  }

  const rawSellingPrice = cost * (1 + effectiveMarkupPercent / 100);
  // Round half-up to 2 decimal places without floating-point representation drift
  const sellingPrice = Math.round((rawSellingPrice + Number.EPSILON) * 100) / 100;

  return {
    purchaseCost: cost,
    effectiveMarkupPercent,
    sellingPrice,
  };
}

pricingRouter.get('/status', (_req, res) => {
  res.json({ module: 'pricing', status: 'ready' });
});
