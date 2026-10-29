import assert from 'node:assert/strict';
import test from 'node:test';
import { formatReadout, gaugePresentation } from './format.ts';

test('currency suffix is shown as a prefix and money keeps two decimals', () => {
  assert.equal(formatReadout(427.5, '', '$'), '$427.50');
  assert.equal(formatReadout(-113.77499999999998, '', ' USD'), '-113.77 USD');
});

test('gauge readout is the real value, not the scale maximum', () => {
  const over = gaugePresentation(10.67, 0, 10, '', 'x');
  assert.equal(over.text, '10.67x');
  assert.equal(over.fraction, 1);
  assert.equal(over.outside, true);
  assert.equal(gaugePresentation(4.266666666666667, 0, 10, '', 'x').text, '4.27x');
});
