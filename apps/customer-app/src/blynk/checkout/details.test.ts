import { expect, test } from 'vitest';
import { deliveryNote, detailsBody, detailsProblem, EMPTY_DETAILS, recipientNameError, recipientPhoneError, type CheckoutDetails } from './details';

const d = (over: Partial<CheckoutDetails> = {}): CheckoutDetails => ({ ...EMPTY_DETAILS, ...over });

test('nothing extra is sent for a plain order', () => {
  expect(detailsBody(d(), true)).toEqual({});
  expect(detailsProblem(d(), true)).toBeNull();
});

test('for someone else sends the receiver (E.164 phone, tidy name) with for_someone_else', () => {
  const body = detailsBody(d({ forSomeoneElse: true, recipientName: '  Fathima   Rizna ', recipientPhone: '077 123 4567' }), true);
  expect(body).toEqual({ for_someone_else: true, recipient: { name: 'Fathima Rizna', phone: '+94771234567' } });
});

test('switched off by staff: the receiver is ignored, never sent', () => {
  const on = d({ forSomeoneElse: true, recipientName: '', recipientPhone: '' });
  expect(detailsProblem(on, false)).toBeNull();
  expect(detailsBody(on, false)).toEqual({});
});

test('receiver checks use the Flutter wording', () => {
  expect(detailsProblem(d({ forSomeoneElse: true, recipientName: 'A', recipientPhone: '0771234567' }), true)).toBe("Enter the receiver's name");
  expect(detailsProblem(d({ forSomeoneElse: true, recipientName: 'Amma', recipientPhone: '0112345678' }), true)).toBe("Enter the receiver's Sri Lankan mobile number");
  expect(recipientNameError('Nimal Perera')).toBeNull();
  expect(recipientNameError('Nimal123')).not.toBeNull();
  expect(recipientPhoneError('+94 76 555 1234')).toBeNull();
  expect(recipientPhoneError('0731234567')).not.toBeNull();
});

test('note joins the quick picks and the typed note; needs help is a flag', () => {
  const x = d({ noteChips: ['Leave at door'], note: ' Gate code 12 ', needsHelp: true });
  expect(deliveryNote(x)).toBe('Leave at door, Gate code 12');
  expect(detailsBody(x, true)).toEqual({ delivery_note: 'Leave at door, Gate code 12', needs_help: true });
});

test('an over-long note stops the order', () => {
  expect(detailsProblem(d({ note: 'x'.repeat(301) }), true)).toBe('Check the note for the rider');
  expect(detailsProblem(d({ note: 'x'.repeat(300) }), true)).toBeNull();
});
