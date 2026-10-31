import assert from 'node:assert/strict';
import test from 'node:test';
import type { Extraction } from '../../shared/intake.ts';
import { blockers, canGo, initialIntake, intakeReducer } from './intake-state.ts';

const f = (value: string | null, confidence = 0.95, quoteFound = true) => ({ value, confidence, quote: value, quoteFound });
const extraction: Extraction = {
  legal_name: f('Tallowbrook Analytics LLC', 0.5),
  contact_email: f('sam@tallowbrook', 0.6),
  tax_id: f(null, 0),
  country: f('United States'),
  annual_spend_usd: f('140000'),
  payment_terms_days: f('15'),
  handles_personal_data: f('yes'),
  start_date: f(null, 0),
};

test('extraction moves to step 1 and seeds values', () => {
  const s = intakeReducer(initialIntake, { type: 'extract_ok', extraction });
  assert.equal(s.step, 1);
  assert.equal(s.values.country, 'United States');
  assert.equal(s.values.tax_id, '');
  assert.equal(s.audit.length, 1);
});

test('gaps block review until fixed or confirmed; state carries across steps', () => {
  let s = intakeReducer(initialIntake, { type: 'extract_ok', extraction });
  assert.equal(canGo(s, 2), false);
  assert.deepEqual(blockers(s).map((b) => b.id), ['legal_name', 'contact_email', 'tax_id', 'start_date']);
  s = intakeReducer(s, { type: 'confirm', id: 'legal_name', value: true });
  s = intakeReducer(s, { type: 'edit', id: 'contact_email', value: 'sam@tallowbrook.example' });
  s = intakeReducer(s, { type: 'edit', id: 'tax_id', value: '83-1047265' });
  s = intakeReducer(s, { type: 'edit', id: 'start_date', value: '2027-02-01' });
  assert.equal(blockers(s).length, 0);
  s = intakeReducer(s, { type: 'goto', step: 2 });
  assert.equal(s.step, 2);
  assert.match(s.audit.at(-1)!.what, /edited Contact email, Tax ID, Start date/);
  s = intakeReducer(s, { type: 'goto', step: 1 });
  assert.equal(s.values.tax_id, '83-1047265'); // nothing lost going back
  assert.equal(s.confirmed.legal_name, true);
});

test('blocked goto is a no-op; send back needs a note; approve only on step 3', () => {
  const s1 = intakeReducer(initialIntake, { type: 'extract_ok', extraction });
  assert.equal(intakeReducer(s1, { type: 'goto', step: 3 }).step, 1);
  assert.equal(intakeReducer(s1, { type: 'decide', kind: 'approved', note: '' }).outcome, null);
  let s = s1;
  for (const [id, v] of [['contact_email', 'a@b.example'], ['tax_id', '83-1047265'], ['start_date', '2027-02-01']] as const) s = intakeReducer(s, { type: 'edit', id, value: v });
  s = intakeReducer(s, { type: 'confirm', id: 'legal_name', value: true });
  s = intakeReducer(intakeReducer(s, { type: 'goto', step: 2 }), { type: 'goto', step: 3 });
  assert.equal(intakeReducer(s, { type: 'decide', kind: 'sent_back', note: '  ' }).outcome, null);
  const back = intakeReducer(s, { type: 'decide', kind: 'sent_back', note: 'Need the W-9' });
  assert.deepEqual(back.outcome, { kind: 'sent_back', note: 'Need the W-9' });
  assert.equal(intakeReducer(s, { type: 'decide', kind: 'approved', note: '' }).outcome?.kind, 'approved');
});

test('editing a value back to the model value clears the edited mark', () => {
  let s = intakeReducer(initialIntake, { type: 'extract_ok', extraction });
  s = intakeReducer(s, { type: 'edit', id: 'country', value: 'Canada' });
  assert.equal(s.edited.country, true);
  s = intakeReducer(s, { type: 'edit', id: 'country', value: 'United States' });
  assert.equal(s.edited.country, false);
});

test('Back and Next with unchanged values logs "Reviewer confirmed" once; a new edit logs once more', () => {
  let s = intakeReducer(initialIntake, { type: 'extract_ok', extraction });
  s = intakeReducer(s, { type: 'confirm', id: 'legal_name', value: true });
  for (const [id, v] of [['contact_email', 'a@b.example'], ['tax_id', '83-1047265'], ['start_date', '2027-02-01']] as const) s = intakeReducer(s, { type: 'edit', id, value: v });
  const confirmations = (x: typeof s) => x.audit.filter((e) => e.what.startsWith('Reviewer confirmed')).length;
  s = intakeReducer(s, { type: 'goto', step: 2 });
  s = intakeReducer(s, { type: 'goto', step: 1 });
  s = intakeReducer(s, { type: 'goto', step: 2 });
  s = intakeReducer(s, { type: 'goto', step: 1 });
  s = intakeReducer(s, { type: 'goto', step: 3 });
  assert.equal(confirmations(s), 1);
  s = intakeReducer(s, { type: 'goto', step: 1 });
  s = intakeReducer(s, { type: 'edit', id: 'country', value: 'Canada' });
  s = intakeReducer(s, { type: 'goto', step: 2 });
  assert.equal(confirmations(s), 2);
  assert.match(s.audit.at(-1)!.what, /edited Contact email, Tax ID, Country, Start date/);
});
