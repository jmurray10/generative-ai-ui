import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_DOCS, verifyAnswer, verifyCitation } from './workbench.ts';

const doc = REVIEW_DOCS[0];

test('a quote on the cited line verifies; a wrong line does not', () => {
  assert.equal(verifyCitation(doc, { page: 2, line: 2, quote: 'by giving 90 days written notice' }).verified, true);
  const wrong = verifyCitation(doc, { page: 2, line: 5, quote: 'by giving 90 days written notice' });
  assert.equal(wrong.verified, false);
  assert.match(wrong.reason ?? '', /not found on page 2, line 5/);
});

test('a quote that runs into the next line still verifies', () => {
  assert.equal(verifyCitation(doc, { page: 1, line: 8, quote: 'successive 12-month periods unless either party gives written notice' }).verified, true);
});

test('missing pages, lines and too-short quotes fail with a reason', () => {
  assert.match(verifyCitation(doc, { page: 9, line: 1, quote: 'whatever text here' }).reason ?? '', /page 9/);
  assert.match(verifyCitation(doc, { page: 1, line: 99, quote: 'whatever text here' }).reason ?? '', /line 99/);
  assert.match(verifyCitation(doc, { page: 1, line: 1, quote: 'AGREE' }).reason ?? '', /too short/);
});

test('an answer is verified only when every claim has a verified citation', () => {
  const ok = verifyAnswer(doc, { answer: '90 days', claims: [{ text: '90 days notice', citations: [{ page: 2, line: 2, quote: '90 days written notice' }] }] });
  assert.equal(ok.status, 'verified');
  const bad = verifyAnswer(doc, { answer: '90 days', claims: [
    { text: '90 days notice', citations: [{ page: 2, line: 2, quote: '90 days written notice' }] },
    { text: 'late fee 1.5%', citations: [{ page: 1, line: 6, quote: 'interest of 1.5% per month' }] },
  ] });
  assert.equal(bad.status, 'couldnt_verify');
  assert.equal(bad.problems.length, 1);
});

test('"not in the document" and uncited answers are couldnt_verify, not a confident blank', () => {
  assert.equal(verifyAnswer(doc, { answer: 'Not stated.', notInDocument: true, claims: [] }).status, 'couldnt_verify');
  assert.equal(verifyAnswer(doc, { answer: 'It is 2%.', claims: [] }).status, 'couldnt_verify');
});
