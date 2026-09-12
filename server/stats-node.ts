import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { StatsStore } from './stats-store';
import { StatsService } from './stats-service';
import type { StatsConfig } from '../shared/stats';

export function createNodeStats(config: StatsConfig & { STATS_DB_PATH?: string }, fetcher?: typeof fetch) {
  if (!config.STATS_ADMIN_PASSWORD) return;
  const path = config.STATS_DB_PATH === ':memory:' ? ':memory:' : resolve(config.STATS_DB_PATH || 'data/stats.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const store = new StatsStore((sql, ...params) => db.prepare(sql).all(...params), run => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = run(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  const service = new StatsService(store, config, fetcher);
  let maintenance: Promise<unknown> = Promise.resolve();
  let maintaining = false;
  const maintain = () => {
    if (maintaining) return;
    maintaining = true;
    try { store.prune(service.retentionDays); }
    catch { console.error('Nepavyko išvalyti pasibaigusios administravimo istorijos.'); }
    maintenance = service.flushNotifications().catch(() => console.error('Nepavyko apdoroti pranešimų eilės.')).finally(() => { maintaining = false; });
  };
  maintain();
  const timer = setInterval(maintain, 15_000);
  timer.unref();
  return { service, close: async () => { clearInterval(timer); await maintenance; db.close(); } };
}
