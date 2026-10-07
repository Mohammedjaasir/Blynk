import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { SmsOffers } from '../pages/SmsOffers';
import { AuthProvider } from '../auth/AuthContext';
import { ApiError, tokenStore } from '../api/client';
import type { SmsLanguage, SmsOffer, SmsOfferEstimate } from '../api/types';
import { OPT_OUT_LINE, languageList, offerInput, offerParts, smsOfferErrorMessage, smsParts, withOptOut } from '../lib/smsOffers';
import { respond, stubFetch, type Handler } from './fetchStub';

/**
 * SMS offers page (backend migration 027). Who is reached, the fallback,
 * the opt-out line and the sending hours are tested against PostgreSQL in
 * backend/api/tests/sms-offers.test.ts; here, what the page asks for and shows.
 */

/** The backend's SMS_OFFER_LANGUAGES for the current test (['en'] at launch). */
let enabledLanguages: SmsLanguage[] = ['si', 'ta', 'en'];

/**
 * What the API would answer: with one language on, everyone gets it;
 * enabled languages with recipients but no text are missing.
 */
function estimateFor(body: Record<string, unknown> | undefined, overrides: Partial<SmsOfferEstimate> = {}): SmsOfferEstimate {
  const messages = (body?.messages ?? {}) as Partial<Record<SmsLanguage, string>>;
  const byLanguage: Record<SmsLanguage, number> =
    enabledLanguages.length === 1 ? { si: 0, ta: 0, en: 0, [enabledLanguages[0]!]: 35 } : { si: 10, ta: 20, en: 5 };
  return {
    audience: 'ALL',
    recipients: 35,
    by_language: byLanguage,
    without_language: 4,
    opted_out: 3,
    parts_per_sms: {},
    sms_parts_total: 70,
    missing_languages: enabledLanguages.filter((l) => byLanguage[l] > 0 && !messages[l]),
    languages: enabledLanguages,
    ...overrides,
  };
}

function offer(overrides: Partial<SmsOffer> = {}): SmsOffer {
  return {
    id: 'so1',
    audience: 'ORDERED_30D',
    fallback_language: 'en',
    message_si: 'සිංහල දීමනාව',
    message_ta: 'தமிழ் சலுகை',
    message_en: 'Rice 10% off today only',
    recipient_count: 120,
    sms_parts_total: 240,
    created_at: '2026-10-05T05:30:00.000Z',
    sent_by_name: 'Nawaz Mansoor',
    sent_by_role: 'ADMIN',
    ...overrides,
  };
}

/** Routes the offer endpoints; `extra` answers anything it returns a response for first. */
function stubOffers(extra: (method: string, path: string, body: Record<string, unknown> | undefined) => Promise<Response> | null = () => null, history: SmsOffer[] = []) {
  const handler: Handler = (method, path, body) => {
    const custom = extra(method, path, body);
    if (custom) return custom;
    if (path === '/admin/sms-offers/estimate') return respond({ estimate: estimateFor(body) });
    if (method === 'GET' && path === '/admin/sms-offers') return respond({ offers: history });
    if (path === '/admin/sms-offers/test') return respond({ sent_to: '+94775****22', sms_parts: 1 }, 202);
    if (method === 'POST' && path === '/admin/sms-offers')
      return respond({ offer: { id: 'new', created_at: '2026-10-06T05:00:00.000Z', recipients: 35, sms_parts_total: 70 } }, 201);
    return respond({});
  };
  return stubFetch(handler);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SmsOffers />
      </ToastProvider>
    </MemoryRouter>
  );
}

/** Renders, then waits for the first estimate to switch on all three languages. */
async function renderAll() {
  renderPage();
  await screen.findByRole('textbox', { name: 'Sinhala text' });
}

const textBox = (name: string) => screen.getByRole('textbox', { name: `${name} text` });

/** Fills all three languages (paste, so the debounce sees one change each). */
async function writeAll(user: ReturnType<typeof userEvent.setup>) {
  for (const [name, text] of [
    ['Sinhala', 'සිංහල දීමනාව'],
    ['Tamil', 'தமிழ் சலுகை'],
    ['English', 'Rice 10% off today'],
  ]) {
    await user.click(textBox(name!));
    await user.paste(text!);
  }
}

const estimatePanel = () => screen.getByRole('complementary', { name: 'Estimate' });

describe('SMS parts (lib)', () => {
  it('counts Unicode (Sinhala/Tamil) at 70 per SMS, 67 per part', () => {
    expect(smsParts('த'.repeat(70))).toBe(1);
    expect(smsParts('த'.repeat(71))).toBe(2);
    expect(smsParts('ස'.repeat(134))).toBe(2);
    expect(smsParts('ස'.repeat(135))).toBe(3);
  });

  it('counts plain English at 160 per SMS, 153 per part', () => {
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('a'.repeat(306))).toBe(2);
    expect(smsParts('a'.repeat(307))).toBe(3);
    // GSM extension characters take two; one Tamil letter makes it Unicode.
    expect(smsParts('€'.repeat(80))).toBe(1);
    expect(smsParts('€'.repeat(81))).toBe(2);
    expect(smsParts(`${'a'.repeat(70)}த`)).toBe(2);
  });

  it('includes the opt-out line in what a recipient costs', () => {
    expect(withOptOut('  Rice 10% off ', 'en')).toBe('Rice 10% off\nStop offers: Blynk app > Profile > SMS & offers');
    expect(offerParts('', 'ta')).toBe(0);
    expect(offerParts('Rice 10% off', 'en')).toBe(1);
    // 112 + newline + the 47-character line = 160: still one; 113 makes it two.
    expect(OPT_OUT_LINE.en).toHaveLength(47);
    expect(offerParts('a'.repeat(112), 'en')).toBe(1);
    expect(offerParts('a'.repeat(113), 'en')).toBe(2);
    expect(offerParts('த'.repeat(10), 'ta')).toBe(smsParts(withOptOut('த'.repeat(10), 'ta')));
  });

  it('sends only the languages that have text', () => {
    expect(offerInput('ALL', 'ta', { si: '  ', ta: ' சலுகை ', en: '' })).toEqual({
      audience: 'ALL',
      fallback_language: 'ta',
      messages: { ta: 'சலுகை' },
    });
    // Languages switched off are never sent, and the fallback is an enabled one.
    expect(offerInput('ALL', 'ta', { si: 'සිංහල', ta: 'சலுகை', en: ' Rice ' }, ['en'])).toEqual({
      audience: 'ALL',
      fallback_language: 'en',
      messages: { en: 'Rice' },
    });
    expect(languageList(['si', 'ta', 'en'])).toBe('Sinhala, Tamil and English');
    expect(smsOfferErrorMessage(new ApiError('x', 400, 'OFFER_TEXT_MISSING', { missing_languages: ['si', 'ta'] }), '')).toBe(
      'Write the Sinhala and Tamil text too.'
    );
  });
});

describe('SMS offers page', () => {
  beforeEach(() => {
    tokenStore.save('access', 'refresh');
    enabledLanguages = ['si', 'ta', 'en'];
  });
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows the live estimate for the chosen audience and fallback', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    await renderAll();
    const panel = estimatePanel();
    await within(panel).findByText('35');
    expect(panel).toHaveTextContent('Recipients35');
    expect(panel).toHaveTextContent('Sinhala10');
    expect(panel).toHaveTextContent('Tamil20');
    expect(panel).toHaveTextContent('English5');
    expect(panel).toHaveTextContent('No language (get English)4');
    expect(panel).toHaveTextContent('Opted out3');
    expect(panel).toHaveTextContent('SMS parts70');

    await user.selectOptions(screen.getByLabelText('Audience'), 'ORDERED_30D');
    await user.selectOptions(screen.getByLabelText('Customers without a language get'), 'ta');
    await waitFor(() =>
      expect(api.sent('POST', '/admin/sms-offers/estimate')).toContainEqual({ audience: 'ORDERED_30D', fallback_language: 'ta', messages: {} })
    );
    expect(await within(panel).findByText('No language (get Tamil)')).toBeInTheDocument();
  });

  it('warns about missing languages and keeps Send disabled until they are written', async () => {
    const user = userEvent.setup();
    stubOffers();
    await renderAll();
    const warning = await screen.findByText(/Write the Sinhala, Tamil and English text/);
    expect(warning).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();

    await user.click(textBox('English'));
    await user.paste('Rice 10% off today');
    expect(await screen.findByText(/Write the Sinhala and Tamil text/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();

    await user.click(textBox('Sinhala'));
    await user.paste('සිංහල දීමනාව');
    await user.click(textBox('Tamil'));
    await user.paste('தமிழ் சலுகை');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send offer' })).toBeEnabled());
    expect(screen.queryByText(/Write the .* text/)).toBeNull();
  });

  it('keeps Send disabled when no customer can receive it', async () => {
    const user = userEvent.setup();
    stubOffers((_m, path, body) => (path === '/admin/sms-offers/estimate' ? respond({ estimate: estimateFor(body, { recipients: 0, by_language: { si: 0, ta: 0, en: 0 }, missing_languages: [] }) }) : null));
    await renderAll();
    await user.click(textBox('English'));
    await user.paste('Hello');
    expect(await screen.findByText('No customer in this audience can receive offers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
  });

  it('confirms, sends, and refreshes the history', async () => {
    const user = userEvent.setup();
    let sent = false;
    const api = stubOffers((method, path) =>
      method === 'GET' && path === '/admin/sms-offers' ? respond({ offers: sent ? [offer()] : [] }) : null
    );
    await renderAll();
    expect(await screen.findByText('No offers sent yet')).toBeInTheDocument();
    await writeAll(user);
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);

    const dialog = screen.getByRole('dialog', { name: 'Send offer' });
    expect(dialog).toHaveTextContent('Send to 35 customers, about 70 SMS parts?');
    sent = true;
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Offer sent to 35 customers.')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers')).toEqual([
      {
        audience: 'ALL',
        fallback_language: 'en',
        messages: { si: 'සිංහල දීමනාව', ta: 'தமிழ் சலுகை', en: 'Rice 10% off today' },
      },
    ]);
    expect(await screen.findByRole('table', { name: 'Sent offers' })).toBeInTheDocument();
    expect(api.paths('GET').filter((p) => p === '/admin/sms-offers')).toHaveLength(2);
    // The texts are cleared so the same offer is not sent twice by accident.
    expect(textBox('English')).toHaveValue('');
  });

  it('says when offers cannot be sent at this hour', async () => {
    const user = userEvent.setup();
    stubOffers((method, path) =>
      method === 'POST' && path === '/admin/sms-offers'
        ? respond({ code: 'OUTSIDE_SENDING_HOURS', message: 'Offers can be sent from 8 AM to 9 PM only.' }, 422)
        : null
    );
    await renderAll();
    await writeAll(user);
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offers can be sent from 8 AM to 9 PM only.');
    expect(textBox('English')).toHaveValue('Rice 10% off today');
  });

  it('sends a test to the number entered under "Send test to"', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    await renderAll();
    const tamilTest = screen.getByRole('button', { name: 'Send Tamil test' });
    expect(tamilTest).toBeDisabled();
    await user.type(screen.getByLabelText(/Send test to/), '077 555 1122');
    await user.click(textBox('Tamil'));
    await user.paste(' தமிழ் சலுகை ');
    await user.click(tamilTest);
    expect(await screen.findByText('Test sent to +94775****22')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers/test')).toEqual([
      { language: 'ta', message: 'தமிழ் சலுகை', phone: '077 555 1122' },
    ]);
    expect(screen.getByRole('button', { name: 'Send Sinhala test' })).toBeDisabled();
  });

  it('prefills "Send test to" with the signed-in account’s own phone when it has one', async () => {
    tokenStore.save('access', 'refresh');
    stubOffers((_m, path) =>
      path === '/auth/me'
        ? respond({ id: 'o1', phone: '+94771234567', full_name: 'Ops', email: null, role: 'ADMIN' })
        : null
    );
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <SmsOffers />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByLabelText(/Send test to/)).toHaveValue('+94771234567'));
  });

  it('checks the "Send test to" number before sending', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    await renderAll();
    await user.type(screen.getByLabelText(/Send test to/), '12345');
    await user.click(textBox('English'));
    await user.paste('Hello');
    await user.click(screen.getByRole('button', { name: 'Send English test' }));
    expect(await screen.findByText('Enter a Sri Lankan mobile number, e.g. 077 123 4567.')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers/test')).toEqual([]);
  });

  it('asks for a number when none is entered and the account has no phone', async () => {
    const user = userEvent.setup();
    const api = stubOffers((_m, path) =>
      path === '/admin/sms-offers/test' ? respond({ code: 'NO_TEST_PHONE', message: 'Enter the number to send the test to.' }, 400) : null
    );
    await renderAll();
    expect(screen.getByLabelText(/Send test to/)).toHaveValue('');
    await user.click(textBox('English'));
    await user.paste('Hello');
    await user.click(screen.getByRole('button', { name: 'Send English test' }));
    expect(await screen.findByText('Enter the number to send the test to.')).toBeInTheDocument();
    // Blank: no phone is sent, the API falls back to the account's own.
    expect(api.sent('POST', '/admin/sms-offers/test')).toEqual([{ language: 'en', message: 'Hello' }]);
  });

  it('counts characters and SMS parts and previews the opt-out line', async () => {
    const user = userEvent.setup();
    stubOffers();
    await renderAll();
    expect(screen.getByTestId('count-en')).toHaveTextContent('0 / 480 characters');
    await user.click(textBox('English'));
    await user.paste('a'.repeat(113));
    expect(screen.getByTestId('count-en')).toHaveTextContent('113 / 480 characters · 2 SMS parts with the opt-out line');
    await user.click(textBox('Tamil'));
    await user.paste('சலுகை');
    expect(screen.getByTestId('count-ta')).toHaveTextContent('5 / 480 characters · 1 SMS part with the opt-out line');
    expect(screen.getByLabelText('Tamil preview').textContent).toBe('சலுகை\nசலுகைகளை நிறுத்த: Blynk app > Profile > SMS & offers');
    expect(textBox('Sinhala')).toHaveAttribute('maxLength', '480');
  });

  it('lists sent offers with who, audience, counts and the texts', async () => {
    const user = userEvent.setup();
    stubOffers(undefined, [offer(), offer({ id: 'so2', audience: 'NEVER_ORDERED', message_si: null, message_ta: null, recipient_count: 8, sms_parts_total: 8, sent_by_name: 'Ops Person', sent_by_role: 'OPERATIONS' })]);
    await renderAll();
    const table = await screen.findByRole('table', { name: 'Sent offers' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('5 Oct 2026');
    expect(first).toHaveTextContent('Nawaz Mansoor');
    expect(first).toHaveTextContent('Ordered in last 30 days');
    expect(first).toHaveTextContent('120');
    expect(first).toHaveTextContent('240');
    expect(first).toHaveTextContent('Sinhala: සිංහල දීමනාව');
    expect(second).toHaveTextContent('Ops Person');
    expect(second).toHaveTextContent('Signed up, never ordered');
    expect(second).toHaveTextContent('English: Rice 10% off today only');

    await user.click(within(first!).getByRole('button', { name: /^Show texts/ }));
    const rows = within(table).getAllByRole('row');
    expect(rows[2]).toHaveTextContent('Sinhalaසිංහල දීමනාව');
    expect(rows[2]).toHaveTextContent('Tamilதமிழ் சலுகை');
    expect(rows[2]).toHaveTextContent('English (fallback)Rice 10% off today only');
  });
});

describe('SMS offers page, English only (launch)', () => {
  beforeEach(() => {
    tokenStore.save('access', 'refresh');
    enabledLanguages = ['en'];
  });
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows only the English text, no fallback picker, and sends English with an English fallback', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    renderPage();
    const panel = estimatePanel();
    await within(panel).findByText('35');
    expect(screen.getAllByRole('textbox', { name: / text$/ })).toHaveLength(1);
    expect(textBox('English')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Sinhala text' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Tamil text' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send Tamil test' })).toBeNull();
    expect(screen.queryByLabelText('Customers without a language get')).toBeNull();
    expect(screen.getByTestId('count-en')).toBeInTheDocument();
    expect(screen.queryByTestId('count-si')).toBeNull();

    // Recipients and opted out only: no per-language or "no language" lines.
    expect(panel).toHaveTextContent('Recipients35');
    expect(panel).toHaveTextContent('Opted out3');
    expect(panel).toHaveTextContent('SMS parts70');
    expect(panel).not.toHaveTextContent('Sinhala');
    expect(panel).not.toHaveTextContent('No language');
    expect(screen.getByText(/Write the English text/)).toBeInTheDocument();

    await user.click(textBox('English'));
    await user.paste('Rice 10% off today');
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Offer sent to 35 customers.')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers')).toEqual([
      { audience: 'ALL', fallback_language: 'en', messages: { en: 'Rice 10% off today' } },
    ]);
    expect(api.sent('POST', '/admin/sms-offers/estimate').every((b) => b.fallback_language === 'en')).toBe(true);
  });

  it('shows the three texts and the fallback picker once the estimate says all three are on', async () => {
    enabledLanguages = ['si', 'ta', 'en'];
    stubOffers();
    renderPage();
    // Before the first estimate: English only is assumed.
    expect(screen.getAllByRole('textbox', { name: / text$/ })).toHaveLength(1);
    expect(screen.queryByLabelText('Customers without a language get')).toBeNull();
    expect(await screen.findByRole('textbox', { name: 'Sinhala text' })).toBeInTheDocument();
    expect(textBox('Tamil')).toBeInTheDocument();
    expect(textBox('English')).toBeInTheDocument();
    expect(screen.getByLabelText('Customers without a language get')).toHaveValue('en');
    expect(screen.getByRole('button', { name: 'Send Sinhala test' })).toBeInTheDocument();
    expect(estimatePanel()).toHaveTextContent('No language (get English)4');
  });

  it('still shows the Sinhala and Tamil texts of offers sent before', async () => {
    const user = userEvent.setup();
    stubOffers(undefined, [offer()]);
    renderPage();
    const table = await screen.findByRole('table', { name: 'Sent offers' });
    await user.click(within(table).getByRole('button', { name: /^Show texts/ }));
    const detail = within(table).getAllByRole('row')[2];
    expect(detail).toHaveTextContent('Sinhalaසිංහල දීමනාව');
    expect(detail).toHaveTextContent('Tamilதமிழ் சலுகை');
    expect(detail).toHaveTextContent('English (fallback)Rice 10% off today only');
  });
});
