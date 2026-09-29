import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Feedback } from '../pages/Feedback';
import { tokenStore } from '../api/client';
import type { FeedbackItem } from '../api/types';

/**
 * The Feedback inbox's own behaviour: filter, rendering, optimistic "Mark as
 * read" and its rollback. The API contract (ADMIN only, newest first, status
 * filter, 5-an-hour limit) is tested against PostgreSQL in
 * backend/api/tests/feedback.test.ts.
 */

function respond(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data })),
  } as Response);
}

function item(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'f1',
    rating: 4,
    category: 'DELIVERY',
    message: 'Rider was quick and polite.',
    status: 'NEW',
    created_at: '2026-09-29T04:30:00.000Z',
    user_id: 'u1',
    full_name: 'Nimal Perera',
    phone: '+94771234567',
    ...overrides,
  };
}

const page = (feedback: FeedbackItem[], total_pages = 1) => ({
  feedback,
  pagination: { page: 1, limit: 50, total: feedback.length, total_pages },
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Feedback />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('Feedback inbox', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  function stub(handler: (url: string, init?: RequestInit) => Promise<Response>) {
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
    vi.stubGlobal('fetch', fetchMock);
  }

  const calls = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url).replace(/^.*\/api\/v1/, '')}`);

  it('shows a spinner, then each message with customer, date, category, stars and status', async () => {
    stub(() => respond(page([item(), item({ id: 'f2', rating: null, category: 'APP', full_name: null, message: 'Dark mode please' })])));
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading feedback' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Customer feedback' });
    const [first, second] = within(list).getAllByRole('listitem');

    expect(within(first).getByText('Nimal Perera')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: '+94771234567' })).toHaveAttribute('href', 'tel:+94771234567');
    // 04:30 UTC is 10:00 in Colombo.
    expect(within(first).getByText(/29 Sept? 2026, 10:00/)).toBeInTheDocument();
    expect(within(first).getByText('Delivery')).toBeInTheDocument();
    expect(within(first).getByRole('img', { name: '4 of 5 stars' })).toBeInTheDocument();
    expect(within(first).getByText('New')).toBeInTheDocument();
    expect(within(first).getByText('Rider was quick and polite.')).toBeInTheDocument();

    // No name on the account and no rating: neutral words, nothing invented.
    expect(within(second).getByText('Customer')).toBeInTheDocument();
    expect(within(second).getByText('No rating')).toBeInTheDocument();
    expect(calls()).toEqual(['GET /admin/feedback?status=NEW&page=1&limit=50']);
  });

  it('keeps a long message whole, line breaks included', async () => {
    const long = `${'Very long feedback '.repeat(120)}\nSecond line`;
    stub(() => respond(page([item({ message: long })])));
    renderPage();

    const message = await screen.findByText((_, el) => el?.className === 'feedback-item__message');
    expect(message.textContent).toBe(long);
  });

  it('New / All switches the status filter', async () => {
    stub(() => respond(page([])));
    renderPage();

    expect(await screen.findByText('No new feedback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('No feedback yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls()).toEqual([
      'GET /admin/feedback?status=NEW&page=1&limit=50',
      'GET /admin/feedback?page=1&limit=50',
    ]);
  });

  it('Mark as read flips the row at once and PATCHes status READ', async () => {
    let release!: () => void;
    const patched = new Promise<void>((resolve) => (release = resolve));
    stub((_url, init) => {
      if (init?.method === 'PATCH') return patched.then(() => respond({ feedback: { id: 'f1', status: 'READ' } }));
      return respond(page([item()]));
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));

    // Optimistic: already Read while the request is still in flight.
    expect(within(screen.getByRole('listitem')).getByText('Read')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull();

    release();
    await waitFor(() => expect(calls()).toContain('PATCH /admin/feedback/f1'));
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')!;
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ status: 'READ' });
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('rolls the row back to New and says why when the API refuses', async () => {
    stub((_url, init) => {
      if (init?.method === 'PATCH') return respond({ code: 'FEEDBACK_NOT_FOUND', message: 'Feedback not found.' }, 404);
      return respond(page([item()]));
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));

    expect(await screen.findByText('Feedback not found.')).toBeInTheDocument();
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('New')).toBeInTheDocument();
    expect(within(row).queryByText('Read')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
  });

  it('shows the error, not an empty inbox, when the list fails to load', async () => {
    stub(() => respond({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' }, 500));
    renderPage();

    expect(await screen.findByText(/Database unavailable|went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText('No new feedback')).toBeNull();
  });

  it('offers Load more while pages remain and appends the next page', async () => {
    stub((url) =>
      url.includes('page=2')
        ? respond({ feedback: [item({ id: 'f2', message: 'Second page' })], pagination: { page: 2, limit: 50, total: 2, total_pages: 2 } })
        : respond(page([item()], 2))
    );
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});
