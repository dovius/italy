import { z } from 'zod';

const message = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(10_000),
});
export const chatSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  imageName: z.string().trim().max(250).optional(),
  mode: z.enum(['assistant', 'photo']),
  messages: z.array(message).min(1).max(30),
  image: z.string().max(6_000_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/).optional(),
}).refine((v) => v.messages.at(-1)?.role === 'user', 'Last message must be from user')
  .refine((v) => v.mode !== 'photo' || Boolean(v.image), 'Photo is required')
  .refine((v) => v.mode !== 'assistant' || !v.image, 'Image belongs in photo mode')
  .refine((v) => v.messages.reduce((n, m) => n + m.text.length, 0) <= 50_000, 'Context is too long');

export const sessionSchema = z.object({
  sdp: z.string().min(20).max(65_536).startsWith('v=0'),
  history: z.array(message).max(40).default([]),
}).refine((v) => v.history.reduce((n, m) => n + m.text.length, 0) <= 20_000);

export const speechSchema = z.object({ text: z.string().trim().min(1).max(4096) });
export const hangupSchema = z.object({ sessionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/) });

const transcript = z.object({
  id: z.string().min(1).max(200),
  session: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(4000),
  start: z.number().finite().min(0).max(86_400_000),
  end: z.number().finite().min(0).max(86_400_000),
}).refine(value => value.end >= value.start);
export const liveFragmentsSchema = hangupSchema.extend({ fragments: z.array(transcript).max(80) })
  .refine(value => value.fragments.every(fragment => fragment.session === value.sessionId))
  .refine(value => value.fragments.reduce((sum, fragment) => sum + fragment.text.length, 0) <= 50_000);
