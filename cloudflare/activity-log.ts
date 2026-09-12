import { DurableObject } from 'cloudflare:workers';
import { StatsStore } from '../server/stats-store';
import { StatsService } from '../server/stats-service';
import type { StatsCommand } from '../shared/stats';
import type { Env } from './worker';
import { errorResponse, readJSON, readLimited } from './http';

// One private activity index for the trip; browser session objects retain only
// their existing temporary retry/ownership state.
export class ActivityLog extends DurableObject<Env> {
  private service = new StatsService(new StatsStore(
    (sql, ...params) => this.ctx.storage.sql.exec(sql, ...params).toArray(),
    run => this.ctx.storage.transactionSync(run),
  ), { ...this.env });

  async fetch(request: Request) {
    try {
      const path = new URL(request.url).pathname;
      let result: Response;
      if (path === '/record' && request.method === 'POST') {
        this.service.config.APP_ORIGIN ||= request.headers.get('x-trip-origin') || undefined;
        await this.service.record(await readJSON(request) as StatsCommand);
        result = new Response(null, { status: 204 });
      } else {
        if (!['GET', 'HEAD'].includes(request.method)) request = new Request(request, { body: await readLimited(request, 4096) });
        this.service.config.APP_ORIGIN ||= new URL(request.url).origin;
        result = await this.service.handle(request, request.headers.get('x-stats-client') || 'unknown');
      }
      await this.schedule();
      this.ctx.waitUntil(this.flush());
      return result;
    } catch (error) { return errorResponse(error); }
  }
  private async schedule() {
    const next = this.service.store.nextNotification();
    const desired = Math.max(Date.now() + 1000, Math.min(next ?? Infinity, Date.now() + 86400_000));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || desired < current) await this.ctx.storage.setAlarm(desired);
  }
  private async flush() {
    try { await this.service.flushNotifications(); }
    finally { await this.schedule(); }
  }
  async alarm() {
    this.service.store.prune(this.service.retentionDays);
    await this.flush();
  }
}
