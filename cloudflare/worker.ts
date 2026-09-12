import type { ModelConfig } from '../server/payloads';
import { ServiceError } from '../server/openai';
import { cookie, digest, equalDigest, errorResponse, secured } from './http';
import type { TripSession } from './trip-session';
import type { ActivityLog } from './activity-log';
import type { StatsConfig } from '../shared/stats';
export { TripSession } from './trip-session';
export { ActivityLog } from './activity-log';

export interface Env extends ModelConfig, StatsConfig {
  OPENAI_API_KEY?: string;
  TRIP_ACCESS_TOKEN?: string;
  APP_ORIGIN?: string;
  ASSETS: Fetcher;
  TRIP_SESSIONS: DurableObjectNamespace<TripSession>;
  ACTIVITY_LOG: DurableObjectNamespace<ActivityLog>;
}

const actions = new Set(['/api/chat', '/api/live/session', '/api/live/end', '/api/live/fragments', '/api/transcribe', '/api/speech']);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const cookies: string[] = [];
    const secure = url.protocol === 'https:';
    try {
      if (url.pathname === '/stats' || url.pathname === '/stats/') {
        const response = secured(await env.ASSETS.fetch(request));
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        return response;
      }
      if (url.pathname === '/api/stats' || url.pathname.startsWith('/api/stats/')) {
        const headers = new Headers(request.headers);
        headers.set('x-stats-client', await digest(request.headers.get('cf-connecting-ip') || 'unknown'));
        const response = secured(await env.ACTIVITY_LOG.getByName('trip').fetch(new Request(request, { headers })));
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        return response;
      }
      if (url.pathname.startsWith('/join/')) {
        if (request.method !== 'GET') return secured(new Response(null, { status: 405, headers: { Allow: 'GET' } }));
        const supplied = decodeURIComponent(url.pathname.slice('/join/'.length));
        if (env.TRIP_ACCESS_TOKEN) {
          const expected = await digest(env.TRIP_ACCESS_TOKEN);
          if (equalDigest(await digest(supplied), expected)) cookies.push(cookie('trip_access', expected, secure));
        }
        return secured(new Response(null, { status: 303, headers: { Location: '/' } }), cookies);
      }
      if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

      let visitor = request.headers.get('cookie')?.match(/(?:^|;\s*)trip_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
      if (!visitor) { visitor = crypto.randomUUID(); cookies.push(cookie('trip_visitor', visitor, secure)); }
      if (url.pathname === '/api/health' && ['GET', 'HEAD'].includes(request.method)) {
        return secured(new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true, configured: Boolean(env.OPENAI_API_KEY) }), { headers: { 'Content-Type': 'application/json' } }), cookies);
      }
      if (!actions.has(url.pathname) || request.method !== 'POST') throw new ServiceError(404, 'not_found', 'Tokio veiksmo nėra. Grįžkite į pradžią.');
      if (request.headers.get('origin') !== (env.APP_ORIGIN || url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
        throw new ServiceError(403, 'origin', 'Atverkite vertėją jo įprastu adresu ir pabandykite dar kartą.');
      }
      if (env.TRIP_ACCESS_TOKEN) {
        const access = request.headers.get('cookie')?.match(/(?:^|;\s*)trip_access=([a-f0-9]{64})(?:;|$)/)?.[1];
        if (!access || !equalDigest(access, await digest(env.TRIP_ACCESS_TOKEN))) throw new ServiceError(403, 'trip_access', 'Atverkite kelionės organizatoriaus atsiųstą vertėjo nuorodą. Taip galėsite tęsti be registracijos.');
      }
      // Route the unparsed body: large photo JSON never consumes the edge Worker's
      // 10 ms CPU budget. Each anonymous browser owns a separate SQLite object.
      const session = env.TRIP_SESSIONS.getByName(visitor);
      const headers = new Headers(request.headers);
      headers.set('x-trip-visitor', await digest(visitor));
      headers.set('x-trip-origin', env.APP_ORIGIN || url.origin);
      return secured(await session.fetch(new Request(request, { headers })), cookies);
    } catch (error) { return secured(errorResponse(error), cookies); }
  },
} satisfies ExportedHandler<Env>;
