import type { ChatResult, Citation } from '../shared/types';
import { ServiceError } from './openai';

type ResponseOutput = {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[];
};

export function extractResponse(data: ResponseOutput): ChatResult {
  let text = '';
  const sources: Citation[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) text += part.text;
      if (part.type === 'refusal' && part.refusal) text += part.refusal;
      for (const annotation of part.annotations ?? []) {
        if (annotation.type === 'url_citation' && annotation.url && /^https?:\/\//.test(annotation.url) && !sources.some((s) => s.url === annotation.url)) {
          sources.push({ url: annotation.url, title: annotation.title || new URL(annotation.url).hostname });
        }
      }
    }
  }
  if (!text.trim() || data.status === 'incomplete' || data.status === 'failed') {
    throw new ServiceError(502, 'incomplete', 'Nepavyko gauti viso atsakymo. Pabandykite dar kartą arba užduokite trumpesnį klausimą.');
  }
  // OpenAI citation markers are rendered as accessible source links below the answer.
  return { text: text.replace(/cite[^]*/g, '').trim(), sources };
}

