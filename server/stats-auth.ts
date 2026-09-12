import { z } from 'zod';
import { ServiceError } from './openai';

export async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function passwordMatches(supplied: string, expected: string) {
  return equal(await hash(supplied), await hash(expected));
}
async function sign(value: string, password: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`stats-session:${value}`));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function adminCookie(password: string, secure: boolean) {
  const payload = `${Date.now() + 8 * 3600_000}.${crypto.randomUUID()}`;
  return `stats_admin=${payload}.${await sign(payload, password)}; Path=/api/stats; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? '; Secure' : ''}`;
}
export async function isAdmin(request: Request, password: string) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)stats_admin=(\d+\.[a-f0-9-]{36}\.[a-f0-9]{64})(?:;|$)/)?.[1];
  if (!value) return false;
  const [expires, nonce, signature] = value.split('.');
  if (Number(expires) <= Date.now() || Number(expires) > Date.now() + 8 * 3600_000) return false;
  return equal(signature, await sign(`${expires}.${nonce}`, password));
}
export function checkOrigin(request: Request, origin?: string) {
  if (request.headers.get('origin') !== (origin || new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ServiceError(403, 'origin', 'Atverkite puslapį jo įprastu adresu ir pabandykite dar kartą.');
  }
}
export const statsFilters = z.object({
  kind: z.enum(['', 'question', 'photo', 'live', 'dictation', 'speech']).default(''),
  visitor: z.string().max(64).default(''),
  conversation: z.string().max(200).default(''),
  q: z.string().trim().max(200).default(''),
  from: z.coerce.number().int().min(0).default(0),
  to: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});
export type StatsFilters = z.infer<typeof statsFilters>;
