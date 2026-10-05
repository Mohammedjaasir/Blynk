import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { DentalDoctor, DoctorRating, DoctorRatingsResult } from '../api/types';
import { formatRating } from '../lib/dental';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Doctor ratings (backend migration 023): the doctors list shows each
 * doctor's visible rating, and a per-doctor Ratings screen lists every
 * rating (hidden ones included) with a Hide/Show button.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function doctor(overrides: Partial<DentalDoctor> = {}): DentalDoctor {
  return {
    id: 'dr1',
    full_name: 'Dr. Nadia Farook',
    specialty: 'ORTHODONTIST',
    photo_url: null,
    bio: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function rating(overrides: Partial<DoctorRating> = {}): DoctorRating {
  return {
    id: 'r1',
    appointment_id: 'ap1',
    stars: 5,
    comment: 'Very gentle.',
    created_at: '2026-01-05T10:00:00Z',
    hidden_at: null,
    is_hidden: false,
    visit_at: '2026-01-05T04:00:00Z',
    patient_name: 'Nimal Perera',
    clinic: { id: 'cl1', name: 'Smile Dental' },
    ...overrides,
  };
}

function result(ratings: DoctorRating[], overrides: Partial<DoctorRatingsResult> = {}): DoctorRatingsResult {
  return {
    doctor: { id: 'dr1', full_name: 'Dr. Nadia Farook', rating_average: 4.5, rating_count: 2 },
    hidden_count: ratings.filter((r) => r.is_hidden).length,
    ratings,
    pagination: { page: 1, limit: 50, total: ratings.length, total_pages: 1 },
    ...overrides,
  };
}

describe('formatRating', () => {
  it('shows one decimal and the count, or nothing without ratings', () => {
    expect(formatRating(4.6, 12)).toBe('★ 4.6 (12)');
    expect(formatRating(4, 3)).toBe('★ 4.0 (3)');
    expect(formatRating(null, 0)).toBeNull();
    expect(formatRating(undefined, undefined)).toBeNull();
  });
});

describe('Dental doctor ratings', () => {
  it('the doctors list shows each rating and links to the ratings screen', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/dental/doctors', {
      'GET /admin/dental/doctors': () =>
        ok({
          doctors: [
            doctor({ rating_average: 4.6, rating_count: 12 }),
            doctor({ id: 'dr2', full_name: 'Dr. New', rating_average: null, rating_count: 0 }),
          ],
        }),
    });
    expect(await screen.findByText('Orthodontist · ★ 4.6 (12)')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[1]).queryByText(/★/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Ratings for Dr. Nadia Farook' })).toHaveAttribute(
      'href',
      '/catalog/dental/doctors/dr1/ratings'
    );
  });

  it('lists ratings with stars, comment, patient, clinic and hidden state', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/dental/doctors/dr1/ratings', {
      'GET /admin/dental/doctors/:id/ratings': () =>
        ok(result([rating(), rating({ id: 'r2', stars: 1, comment: 'rude words', is_hidden: true, hidden_at: '2026-01-06T00:00:00Z' })])),
    });
    expect(await screen.findByRole('heading', { name: 'Dr. Nadia Farook — ratings' })).toBeInTheDocument();
    expect(screen.getByText('★ 4.5 (2) · 1 hidden')).toBeInTheDocument();
    expect(screen.getByLabelText('5 out of 5 stars')).toHaveTextContent('★★★★★');
    expect(screen.getByText('“Very gentle.”')).toBeInTheDocument();
    expect(screen.getAllByText('Nimal Perera · Smile Dental · Visit 05 Jan 2026')).toHaveLength(2);
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
  });

  it('hides a rating and reloads', async () => {
    const user = userEvent.setup();
    let hidden = false;
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/dental/doctors/dr1/ratings', {
      'GET /admin/dental/doctors/:id/ratings': () =>
        ok(result([rating({ is_hidden: hidden, hidden_at: hidden ? '2026-01-06T00:00:00Z' : null })])),
      'PATCH /admin/dental/ratings/:id/hidden': (call) => {
        hidden = call.body.hidden;
        return ok({ rating: { id: 'r1', is_hidden: hidden, hidden_at: null } });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/dental/ratings/r1/hidden')[0]?.body).toEqual({ hidden: true }));
    expect(await screen.findByRole('button', { name: 'Show' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Rating hidden.');
  });

  it('shows the API refusal and an empty state', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/dental/doctors/dr1/ratings', {
      'GET /admin/dental/doctors/:id/ratings': () => ok(result([rating()])),
      'PATCH /admin/dental/ratings/:id/hidden': () => fail(404, 'RATING_NOT_FOUND', 'Rating not found.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(await screen.findByText('Rating not found.')).toBeInTheDocument();
    cleanup();

    renderAs(OPERATIONS_STAFF, '/catalog/dental/doctors/dr1/ratings', {
      'GET /admin/dental/doctors/:id/ratings': () =>
        ok(result([], { doctor: { id: 'dr1', full_name: 'Dr. Nadia Farook', rating_average: null, rating_count: 0 } })),
    });
    expect(await screen.findByText('No ratings yet')).toBeInTheDocument();
    expect(screen.getByText('No visible ratings yet')).toBeInTheDocument();
  });
});
