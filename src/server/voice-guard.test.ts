import assert from 'node:assert/strict';
import test from 'node:test';
import { clientIpOf, isPrivateAddress, originAllowed } from './voice-guard.ts';

test('originAllowed: same hostname or allow-listed; other sites are rejected', () => {
  assert.equal(originAllowed('http://localhost:8080', 'localhost:8080'), true);
  assert.equal(originAllowed('http://localhost:8080', 'localhost'), true); // proxy dropped the port
  assert.equal(originAllowed('https://genui.example.com', 'genui.example.com'), true);
  assert.equal(originAllowed('https://evil.example', 'genui.example.com'), false);
  assert.equal(originAllowed('https://genui.example.com.evil.example', 'genui.example.com'), false);
  assert.equal(originAllowed('null', 'localhost:8080'), false);
  assert.equal(originAllowed('https://app.example', 'api.internal', 'https://app.example'), true);
  assert.equal(originAllowed(undefined, 'localhost'), true); // non-browser client
});

test('clientIpOf: trusts only private hops, so a client cannot pick its own IP', () => {
  // Direct exposure: the socket address wins, X-Forwarded-For is ignored.
  assert.equal(clientIpOf('203.0.113.9', '1.2.3.4'), '203.0.113.9');
  // Behind nginx (private): the rightmost public entry is the client nginx saw.
  assert.equal(clientIpOf('172.18.0.3', '6.6.6.6, 198.51.100.7'), '198.51.100.7');
  assert.equal(clientIpOf('::ffff:172.18.0.3', '198.51.100.7, 10.0.0.2'), '198.51.100.7');
  // Local development: everything private, use the original client.
  assert.equal(clientIpOf('127.0.0.1', undefined), '127.0.0.1');
  assert.equal(clientIpOf('172.18.0.3', '172.18.0.1'), '172.18.0.1');
  // Proxy trust turned off.
  assert.equal(clientIpOf('172.18.0.3', '198.51.100.7', 'false'), '172.18.0.3');
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});
