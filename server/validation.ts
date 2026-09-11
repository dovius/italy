import { z } from 'zod';

const message = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(10_000),
});
export const chatSchema = z.object({
  requestId: z.string().uuid(),
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
