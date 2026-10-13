import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import PromoBanner from './PromoBanner';
import { dairy, milk } from '../test/fixtures';
import type { Promotion } from '../api/types';

const promo = (o: Partial<Promotion>): Promotion => ({ id: 'x', title: 'Promo', subtitle: null, image_url: 'https://img/x.webp', background_type: 'IMAGE', background_color: null, background_color_end: null, background_image_url: null, background_focal_x: 50, background_focal_y: 50, cta_label: null, cta_destination_type: null, cta_destination_value: null, display_order: 0, ...o });
function Where() { return <span data-testid="loc">{useLocation().pathname}</span>; }
const show = (p: Promotion) => render(
  <MemoryRouter initialEntries={["/start"]}><Routes><Route path="*" element={<><PromoBanner promotions={[p]} products={[milk]} minPrice={1} categories={[dairy]} /><Where /></>} /></Routes></MemoryRouter>
);

test.each([
  [{ cta_destination_type: 'CATEGORY', cta_destination_value: 'dairy-eggs' }, '/aisle/dairy-eggs'],
  [{ cta_destination_type: 'CATEGORY', cta_destination_value: 'c-dairy' }, '/aisle/dairy-eggs'],
  [{ cta_destination_type: 'PRODUCT', cta_destination_value: 'p-milk' }, '/p/p-milk'],
  [{ cta_destination_type: 'CATALOG', cta_destination_value: null }, '/'],
] as [Partial<Promotion>, string][])('tapping a promotion %j goes to %s', async (o, path) => {
  show(promo(o));
  await userEvent.click(screen.getByRole('img', { name: 'Promo' }));
  expect(screen.getByTestId('loc')).toHaveTextContent(path);
});

test('a promotion without a destination is not a link', () => {
  show(promo({}));
  expect(screen.queryByRole('link')).toBeNull();
});
