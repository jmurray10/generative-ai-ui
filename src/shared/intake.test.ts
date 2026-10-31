import assert from 'node:assert/strict';
import test from 'node:test';
import { FIELDS, flagFor, provisionalResult, quoteInSource, validateField } from './intake.ts';

const def = (id: string) => FIELDS.find((f) => f.id === id)!;

test('flags: confident needs high confidence AND a quote found in the source', () => {
  assert.equal(flagFor({ value: 'x', confidence: 0.95, quote: 'x', quoteFound: true }), 'confident');
  assert.equal(flagFor({ value: 'x', confidence: 0.95, quote: 'x', quoteFound: false }), 'check');
  assert.equal(flagFor({ value: 'x', confidence: 0.5, quote: 'x', quoteFound: true }), 'check');
  assert.equal(flagFor({ value: null, confidence: 0.9, quote: null, quoteFound: false }), 'missing');
  assert.equal(flagFor(undefined), 'missing');
});

test('quoteInSource ignores case and whitespace but needs the text', () => {
  assert.equal(quoteInSource('Our tax ID is  47-2958316', 'tax id is 47-2958316'), true);
  assert.equal(quoteInSource('Our tax ID is 47-2958316', '47-0000000'), false);
});

test('validators', () => {
  assert.equal(validateField(def('contact_email'), 'sam@tallowbrook'), 'Enter an email like name@company.com.');
  assert.equal(validateField(def('tax_id'), '47-2958316'), null);
  assert.ok(validateField(def('tax_id'), 'pending'));
  assert.equal(validateField(def('annual_spend_usd'), '$64,000'), null);
  assert.ok(validateField(def('start_date'), 'early next quarter'));
  assert.ok(validateField(def('legal_name'), ''));
});

test('provisional result: standard vs enhanced, and ready only when every check passes', () => {
  const today = new Date('2026-10-30T12:00:00Z');
  const base = { legal_name: 'Fernhill Catering Ltd.', contact_email: 'a@b.example', tax_id: '47-2958316', country: 'Canada', annual_spend_usd: '64000', payment_terms_days: '30', handles_personal_data: 'no', start_date: '2027-01-11' };
  const std = provisionalResult(base, today);
  assert.equal(std.tier, 'standard');
  assert.equal(std.ready, true);
  const enh = provisionalResult({ ...base, annual_spend_usd: '140000', handles_personal_data: 'yes', payment_terms_days: '15' }, today);
  assert.equal(enh.tier, 'enhanced');
  assert.equal(enh.reasons.length, 3);
  const past = provisionalResult({ ...base, start_date: '2026-01-01' }, today);
  assert.equal(past.ready, false);
});
