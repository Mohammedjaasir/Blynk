import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { SmsLanguage, SmsOffer, SmsOfferEstimate } from '../api/types';
import { OPT_OUT_LINE, smsParts, withOptOut } from '../lib/sms';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * More -> SMS offers (owner, 2026-10-06). The backend
 * (backend/api/tests/sms-offers.test.ts) is the real guard for languages,
 * opt-outs and sending hours; these tests cover what the screen shows and
 * sends.
 */

// The estimate is debounced; the full auth + shell boot comes first.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const LANGS: SmsLanguage[] = ['si', 'ta', 'en'];
/** The launch setting: offers are written in English only. */
const ENGLISH_ONLY: SmsLanguage[] = ['en'];

/**
 * A fake estimate shaped like the backend's, from what the screen sent.
 * `languages` is what the backend has switched on; these tests default to
 * all three, and the English-only tests pass ENGLISH_ONLY.
 */
function estimateFor(call: Call, byLanguage: Record<SmsLanguage, number>, languages: SmsLanguage[] = LANGS) {
  const messages: Partial<Record<SmsLanguage, string>> = call.body.messages ?? {};
  const parts_per_sms: Partial<Record<SmsLanguage, number>> = {};
  const missing_languages: SmsLanguage[] = [];
  let sms_parts_total = 0;
  for (const l of LANGS) {
    const text = messages[l];
    if (text) parts_per_sms[l] = smsParts(withOptOut(text, l));
    if (byLanguage[l] === 0) continue;
    if (!text) missing_languages.push(l);
    else sms_parts_total += byLanguage[l] * parts_per_sms[l]!;
  }
  const estimate: SmsOfferEstimate = {
    audience: call.body.audience,
    recipients: byLanguage.si + byLanguage.ta + byLanguage.en,
    by_language: byLanguage,
    without_language: 2,
    opted_out: 3,
    parts_per_sms,
    sms_parts_total,
    missing_languages,
    languages,
  };
  return ok({ estimate });
}

const OFFER: SmsOffer = {
  id: 'o1',
  audience: 'ORDERED_30D',
  fallback_language: 'en',
  message_si: null,
  message_ta: 'இன்று காய்கறிகளுக்கு 10% தள்ளுபடி',
  message_en: `Fresh vegetables 10% off today only. ${'Order in the Blynk app now. '.repeat(4)}`,
  recipient_count: 42,
  sms_parts_total: 63,
  created_at: '2026-10-05T04:30:00.000Z',
  sent_by_name: 'Ops Person',
  sent_by_role: 'OPERATIONS',
};

function open(handlers: Record<string, (call: Call) => unknown> = {}) {
  return renderAs(OPERATIONS_STAFF, '/more/sms-offers', {
    'GET /admin/sms-offers': () => ok({ offers: [] }),
    'POST /admin/sms-offers/estimate': (call) => estimateFor(call, { si: 0, ta: 0, en: 10 }),
    ...handlers,
  });
}

const textBox = (name: RegExp) => screen.getByLabelText(name, { selector: 'textarea' });
const sendButton = () => screen.getByRole('button', { name: 'Send offer' });

describe('SMS parts counter', () => {
  it('counts Unicode (Tamil) at 70 per SMS and plain Latin at 160', () => {
    expect(smsParts('த'.repeat(70))).toBe(1);
    expect(smsParts('த'.repeat(71))).toBe(2);
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    // Split messages: 67 Unicode / 153 Latin per part.
    expect(smsParts('த'.repeat(134))).toBe(2);
    expect(smsParts('த'.repeat(135))).toBe(3);
    expect(smsParts('a'.repeat(306))).toBe(2);
    expect(smsParts('a'.repeat(307))).toBe(3);
    // Extension characters take two.
    expect(smsParts('€'.repeat(80))).toBe(1);
    expect(smsParts('€'.repeat(81))).toBe(2);
  });

  it('shows the count and parts with the stop line while typing', async () => {
    open();
    await screen.findByLabelText(/^Tamil text/, { selector: 'textarea' });
    const english = textBox(/^English text/);
    fireEvent.change(english, { target: { value: 'Rice 10% off' } });
    expect(screen.getByTestId('sms-count-en')).toHaveTextContent('12/480 characters · 1 SMS with the stop line');
    expect(screen.getByLabelText('English SMS preview')).toHaveTextContent(
      'Rice 10% off Stop offers: Blynk app > Profile > SMS & offers'
    );
    expect(OPT_OUT_LINE.ta.endsWith('Blynk app > Profile > SMS & offers')).toBe(true);
    expect(OPT_OUT_LINE.si.endsWith('Blynk app > Profile > SMS & offers')).toBe(true);

    // Tamil: the stop line itself is Unicode, so the text has less room.
    const room = 70 - ('\n' + OPT_OUT_LINE.ta).length;
    const tamil = textBox(/^Tamil text/);
    fireEvent.change(tamil, { target: { value: 'த'.repeat(room) } });
    expect(screen.getByTestId('sms-count-ta')).toHaveTextContent(`${room}/480 characters · 1 SMS with`);
    fireEvent.change(tamil, { target: { value: 'த'.repeat(room + 1) } });
    expect(screen.getByTestId('sms-count-ta')).toHaveTextContent(`${room + 1}/480 characters · 2 SMS parts with`);
  });
});

describe('More -> SMS offers', () => {
  it('is reachable from More and shows the live estimate', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/sms-offers': () => ok({ offers: [] }),
      'POST /admin/sms-offers/estimate': (call) => estimateFor(call, { si: 4, ta: 5, en: 6 }),
    });
    await user.click(await screen.findByRole('link', { name: 'SMS offers' }));
    expect(await screen.findByTestId('sms-recipients')).toHaveTextContent('15');
    expect(screen.getByText('Turned offers off').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('No language picked (get English)').nextSibling).toHaveTextContent('2');

    await user.click(screen.getByRole('radio', { name: 'Ordered in last 30 days' }));
    await user.click(screen.getByRole('button', { name: 'Tamil' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/sms-offers/estimate').at(-1)?.body).toEqual({
        audience: 'ORDERED_30D',
        fallback_language: 'ta',
        messages: {},
      })
    );
    expect(screen.getByText('No language picked (get Tamil)')).toBeInTheDocument();
  });

  it('warns about a missing language and keeps Send disabled', async () => {
    open({ 'POST /admin/sms-offers/estimate': (call) => estimateFor(call, { si: 0, ta: 5, en: 10 }) });
    const english = await screen.findByLabelText(/^English text/, { selector: 'textarea' });
    fireEvent.change(english, { target: { value: 'Rice 10% off today' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Write the Tamil text: 5 customers get Tamil.'));
    expect(sendButton()).toBeDisabled();

    fireEvent.change(await screen.findByLabelText(/^Tamil text/, { selector: 'textarea' }), {
      target: { value: 'அரிசி 10% தள்ளுபடி' },
    });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(screen.queryByRole('alert')).toBeNull();
    // 10 English at 1 SMS each, 5 Tamil at 2 (the Tamil stop line is long).
    expect(screen.getByTestId('sms-parts-total')).toHaveTextContent('20');
  });

  it('keeps Send disabled when nobody can get offers', async () => {
    open({ 'POST /admin/sms-offers/estimate': (call) => estimateFor(call, { si: 0, ta: 0, en: 0 }) });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), {
      target: { value: 'Rice 10% off' },
    });
    expect(await screen.findByText('No customer in this group can get offers.')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('asks before sending, sends the texts and shows the new offer', async () => {
    const user = userEvent.setup();
    let sent = false;
    const { api } = open({
      'GET /admin/sms-offers': () => ok({ offers: sent ? [OFFER] : [] }),
      'POST /admin/sms-offers': () => {
        sent = true;
        return { status: 201, data: { offer: { id: 'o1', created_at: OFFER.created_at, recipients: 10, sms_parts_total: 10 } } };
      },
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), {
      target: { value: '  Rice 10% off  ' },
    });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(sendButton());
    const dialog = screen.getByRole('dialog', { name: 'Send offer' });
    expect(dialog).toHaveTextContent('Send to 10 customers, about 10 SMS parts?');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Offer sent to 10 customers (10 SMS parts).')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-offers')[0].body).toEqual({
      audience: 'ALL',
      fallback_language: 'en',
      messages: { en: 'Rice 10% off' },
    });
    expect(textBox(/^English text/)).toHaveValue('');
    expect(await screen.findByRole('list', { name: 'Recent offers' })).toBeInTheDocument();
  });

  it('cancelling the confirm sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = open();
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), {
      target: { value: 'Rice 10% off' },
    });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(sendButton());
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.find('POST', '/admin/sms-offers')).toHaveLength(0);
  });

  it('explains the sending hours when the server says it is too late', async () => {
    const user = userEvent.setup();
    open({
      'POST /admin/sms-offers': () => fail(422, 'OUTSIDE_SENDING_HOURS', 'Offers can be sent from 8 AM to 9 PM only.'),
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), {
      target: { value: 'Rice 10% off' },
    });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(sendButton());
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offers can be sent from 8 AM to 9 PM only.');
    // The text stays, to send later.
    expect(textBox(/^English text/)).toHaveValue('Rice 10% off');
  });

  it('names the missing language when the server reports one', async () => {
    const user = userEvent.setup();
    open({
      'POST /admin/sms-offers': () => ({
        status: 400,
        error: { code: 'OFFER_TEXT_MISSING', message: 'x', details: { missing_languages: ['si', 'ta'] } },
      }),
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), {
      target: { value: 'Rice 10% off' },
    });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(sendButton());
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write the Sinhala and Tamil text first.');
  });

  it('sends a test to the staff member own phone', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'POST /admin/sms-offers/test': () => ({ status: 202, data: { sent_to: '+94775****22', sms_parts: 1 } }),
    });
    const tamil = await screen.findByLabelText(/^Tamil text/, { selector: 'textarea' });
    const testButton = screen.getByRole('button', { name: 'Send Tamil test to my phone' });
    expect(testButton).toBeDisabled();
    fireEvent.change(tamil, { target: { value: 'அரிசி 10% தள்ளுபடி ' } });
    await user.click(testButton);
    expect(await screen.findByText('Test sent to +94775****22')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-offers/test')[0].body).toEqual({ language: 'ta', message: 'அரிசி 10% தள்ளுபடி' });
  });

  it('explains a missing test phone', async () => {
    const user = userEvent.setup();
    open({ 'POST /admin/sms-offers/test': () => fail(400, 'NO_TEST_PHONE') });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), {
      target: { value: 'Rice 10% off' },
    });
    await user.click(screen.getByRole('button', { name: 'Send English test to my phone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account has no mobile number to send the test to.');
  });

  it('lists recent offers with who sent them and shortened texts', async () => {
    open({ 'GET /admin/sms-offers': () => ok({ offers: [OFFER] }) });
    const list = await screen.findByRole('list', { name: 'Recent offers' });
    const [row] = within(list).getAllByRole('listitem');
    expect(row).toHaveTextContent('Ordered in last 30 days');
    expect(row).toHaveTextContent('Ops Person');
    expect(row).toHaveTextContent('42 customers · 63 SMS parts');
    expect(row).toHaveTextContent(`Tamil: ${OFFER.message_ta}`);
    expect(row).toHaveTextContent('English: Fresh vegetables 10% off');
    expect(row).toHaveTextContent('…');
    expect(row).not.toHaveTextContent(OFFER.message_en!.trim());
    expect(row).not.toHaveTextContent('Sinhala:');
  });

  it('shows an empty history', async () => {
    open();
    expect(await screen.findByText('No offers sent yet')).toBeInTheDocument();
  });
});

describe('More -> SMS offers, English only (launch)', () => {
  function openEnglishOnly(handlers: Record<string, (call: Call) => unknown> = {}) {
    return open({
      'POST /admin/sms-offers/estimate': (call) => estimateFor(call, { si: 0, ta: 0, en: 12 }, ENGLISH_ONLY),
      ...handlers,
    });
  }

  it('shows only the English box, no fallback choice and no language breakdown', async () => {
    openEnglishOnly();
    expect(await screen.findByTestId('sms-recipients')).toHaveTextContent('12');
    expect(screen.getByText('Turned offers off').nextSibling).toHaveTextContent('3');
    expect(textBox(/^English text/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Sinhala text/)).toBeNull();
    expect(screen.queryByLabelText(/^Tamil text/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Sinhala|Tamil/ })).toBeNull();
    expect(screen.queryByText('Customers without a language get:')).toBeNull();
    expect(screen.queryByText(/^In English/)).toBeNull();
    expect(screen.queryByText(/No language picked/)).toBeNull();
  });

  it('sends English with English as the fallback', async () => {
    const user = userEvent.setup();
    const { api } = openEnglishOnly({
      'POST /admin/sms-offers': () => ({
        status: 201,
        data: { offer: { id: 'o2', created_at: OFFER.created_at, recipients: 12, sms_parts_total: 12 } },
      }),
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), {
      target: { value: 'Rice 10% off' },
    });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(sendButton());
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Offer sent to 12 customers (12 SMS parts).')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-offers')[0].body).toEqual({
      audience: 'ALL',
      fallback_language: 'en',
      messages: { en: 'Rice 10% off' },
    });
    for (const call of api.find('POST', '/admin/sms-offers/estimate')) {
      expect(call.body.fallback_language).toBe('en');
      expect(Object.keys(call.body.messages).every((l) => l === 'en')).toBe(true);
    }
  });

  it('shows all three boxes and the fallback choice once the backend enables them', async () => {
    open();
    expect(await screen.findByLabelText(/^Sinhala text/, { selector: 'textarea' })).toBeInTheDocument();
    expect(textBox(/^Tamil text/)).toBeInTheDocument();
    expect(textBox(/^English text/)).toBeInTheDocument();
    expect(screen.getByText('Customers without a language get:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sinhala' })).toBeInTheDocument();
    expect(screen.getByText(/No language picked/)).toBeInTheDocument();
  });

  it('still shows old Sinhala and Tamil texts in recent offers', async () => {
    openEnglishOnly({
      'GET /admin/sms-offers': () => ok({ offers: [{ ...OFFER, message_si: 'අද එළවළු 10% අඩුවෙන්' }] }),
    });
    const [row] = within(await screen.findByRole('list', { name: 'Recent offers' })).getAllByRole('listitem');
    expect(row).toHaveTextContent('Sinhala: අද එළවළු 10% අඩුවෙන්');
    expect(row).toHaveTextContent(`Tamil: ${OFFER.message_ta}`);
  });
});
