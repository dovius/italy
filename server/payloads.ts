import type { z } from 'zod';
import type { chatSchema, sessionSchema } from './validation';
import { ASSISTANT_PROMPT, INTERPRETER_PROMPT, PHOTO_PROMPT } from './prompts';

export interface ModelConfig {
  OPENAI_TEXT_MODEL?: string;
  OPENAI_LIVE_MODEL?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  OPENAI_SPEECH_MODEL?: string;
}

// Both hosting targets use the same model instructions and API payloads.
export function chatPayload(input: z.infer<typeof chatSchema>, config: ModelConfig) {
  const context: unknown[] = [];
  if (input.image) context.push({ role: 'user', content: [{ type: 'input_text', text: 'Ši nuotrauka yra viso tolesnio pokalbio kontekstas.' }, { type: 'input_image', image_url: input.image, detail: 'high' }] });
  context.push(...input.messages.map(m => ({ role: m.role, content: m.text })));
  const model = config.OPENAI_TEXT_MODEL || 'gpt-5.6-sol';
  return {
    model,
    service_tier: 'fast',
    ...(/^(gpt-5|gpt-6)/.test(model) ? { reasoning: { effort: 'low' } } : {}),
    instructions: input.mode === 'photo' ? PHOTO_PROMPT : ASSISTANT_PROMPT,
    input: context,
    store: false,
    max_output_tokens: 2200,
    ...(input.mode === 'assistant' ? { tools: [{ type: 'web_search' }], tool_choice: 'auto' } : {}),
  };
}

export function livePayload({ sdp, history }: z.infer<typeof sessionSchema>, config: ModelConfig) {
  return {
    session: {
      model: config.OPENAI_LIVE_MODEL || 'gpt-live-1',
      instructions: INTERPRETER_PROMPT,
      audio: { output: { voice: 'marin' } },
      store: false,
      input: history.map(m => ({ type: 'message', role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.text }] })),
    },
    transport: { type: 'webrtc', sdp },
  };
}

export function speechPayload(text: string, config: ModelConfig) {
  return {
    model: config.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
    voice: 'marin', input: text,
    instructions: 'Read this text exactly, in its original language. Speak clearly at an unhurried pace for an older traveler. Do not add words or translate.',
    response_format: 'mp3',
  };
}

export function transcriptionForm(audio: Blob, config: ModelConfig) {
  const type = audio.type;
  const extension = type.includes('mp4') ? 'm4a' : type.includes('mpeg') ? 'mp3' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', audio, `klausimas.${extension}`);
  form.append('model', config.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('language', 'lt');
  form.append('response_format', 'json');
  return form;
}
