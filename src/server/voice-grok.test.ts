import assert from 'node:assert/strict';
import test from 'node:test';
import { mapGrokServerEvent, sanitizeVoiceError } from './voice-grok.ts';

test('audio and transcript deltas map onto the browser protocol', () => {
  const audio = mapGrokServerEvent({ type: 'response.output_audio.delta', delta: 'AAAA' }, '');
  assert.deepEqual(audio.toClient, [{ type: 'audio', audio: 'AAAA' }]);

  const partial = mapGrokServerEvent({ type: 'response.output_audio_transcript.delta', delta: 'Hel' }, '');
  assert.equal(partial.assistantTranscript, 'Hel');
  assert.deepEqual(partial.toClient[0], { type: 'transcript', who: 'ai', text: 'Hel', partial: true });

  const done = mapGrokServerEvent({ type: 'response.output_audio_transcript.done', transcript: 'Hello' }, 'Hel');
  assert.equal(done.assistantTranscript, '');
  assert.equal((done.toClient[0] as { partial: boolean }).partial, false);
});

test('a finished function call is extracted for the tool runner', () => {
  const mapped = mapGrokServerEvent({
    type: 'response.function_call_arguments.done',
    name: 'refine_ui',
    call_id: 'call_1',
    arguments: '{"instruction":"make it dark"}',
  }, '');
  assert.deepEqual(mapped.functionCall, {
    name: 'refine_ui',
    callId: 'call_1',
    arguments: '{"instruction":"make it dark"}',
  });
});

test('session.updated is the ready signal and errors do not echo a key', () => {
  const ready = mapGrokServerEvent({ type: 'session.updated' }, '');
  assert.equal(ready.ready, true);
  const err = mapGrokServerEvent({ type: 'error', error: { message: 'Unauthorized: bad api key' } }, '');
  assert.match(String((err.toClient[0] as { message: string }).message), /XAI_API_KEY/);
  assert.equal(sanitizeVoiceError('something else went wrong'), 'something else went wrong');
});
