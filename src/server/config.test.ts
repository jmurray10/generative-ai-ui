import assert from 'node:assert/strict';
import test from 'node:test';
import { generatorChoice, voiceChoice, xaiRealtimeURL, grokReasoningEffort, grokModel } from './config.ts';

test('generator defaults to grok and honors stub and gemini', () => {
  assert.equal(generatorChoice({}), 'grok');
  assert.equal(generatorChoice({ GENERATOR: 'stub' }), 'stub');
  assert.equal(generatorChoice({ GENERATOR: 'gemini' }), 'gemini');
  assert.equal(generatorChoice({ GENERATOR: 'nope' }), 'stub');
});

test('voice is grok only when an xAI key is present, gemini only when asked', () => {
  assert.equal(voiceChoice({}), 'off');
  assert.equal(voiceChoice({ XAI_API_KEY: 'present' }), 'grok');
  assert.equal(voiceChoice({ XAI_API_KEY: 'present', VOICE_PROVIDER: 'off' }), 'off');
  assert.equal(voiceChoice({ GEMINI_API_KEY: 'present' }), 'off');
  assert.equal(voiceChoice({ GEMINI_API_KEY: 'present', VOICE_PROVIDER: 'gemini' }), 'gemini');
  assert.equal(voiceChoice({ VOICE_PROVIDER: 'gemini' }), 'off');
});

test('realtime url swaps the configured base onto wss and pins the model', () => {
  const url = new URL(xaiRealtimeURL('grok-voice-latest', { XAI_BASE_URL: 'https://us.api.x.ai/v1' }));
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.host, 'us.api.x.ai');
  assert.equal(url.pathname, '/v1/realtime');
  assert.equal(url.searchParams.get('model'), 'grok-voice-latest');
});

test('grok model and reasoning defaults', () => {
  assert.equal(grokModel({}), 'grok-4.7');
  assert.equal(grokModel({ GROK_MODEL: 'grok-4' }), 'grok-4');
  assert.equal(grokReasoningEffort({}), 'low');
  assert.equal(grokReasoningEffort({ GROK_REASONING_EFFORT: 'high' }), 'high');
  assert.equal(grokReasoningEffort({ GROK_REASONING_EFFORT: 'nope' }), 'low');
});
