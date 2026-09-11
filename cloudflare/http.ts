import { ZodError } from 'zod';
import { ServiceError } from '../server/openai';

export const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function secured(response: Response, cookies: string[] = []) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError) return Response.json({ code: error.code, error: error.message }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ code: 'invalid_input', error: 'Nepavyko perskaityti užklausos. Pabandykite trumpesnį klausimą arba kitą nuotrauką.' }, { status: 400 });
  return Response.json({ code: 'internal', error: 'Vertėjas laikinai nepasiekiamas. Palaukite ir pabandykite dar kartą.' }, { status: 503 });
}

export async function digest(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function equalDigest(a: string, b: string) {
  if (a.length !== 64 || b.length !== 64) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export function cookie(name: string, value: string, secure: boolean) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1209600${secure ? '; Secure' : ''}`;
}

// Enforce actual streamed bytes, even when Content-Length is absent or untrusted.
export async function readLimited(request: Request, max: number) {
  const tooLarge = () => new ServiceError(413, 'too_large', 'Failas per didelis. Pasirinkite mažesnę nuotrauką arba trumpesnį įrašą.');
  if (Number(request.headers.get('content-length')) > max) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return data;
}

export async function readJSON(request: Request, max = 7 * 1024 * 1024): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ServiceError(415, 'invalid_input', 'Nepavyko perskaityti užklausos. Pabandykite dar kartą.');
  return JSON.parse(new TextDecoder().decode(await readLimited(request, max)));
}
