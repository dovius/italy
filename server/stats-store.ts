import type { Activity, ActivityKind, StatsPage, StatsVisitor } from '../shared/stats';
import type { TranscriptFragment } from '../shared/types';
import type { StatsFilters } from './stats-auth';

type Value = string | number | null;
export type Query = (sql: string, ...values: Value[]) => Record<string, unknown>[];
type StoredActivity = Omit<Activity, 'visitorName' | 'fragments'>;
const PAGE_SIZE = 30;

export class StatsStore {
  constructor(private query: Query, private transaction: <T>(run: () => T) => T) {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS stats_visitors (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '')`,
      `CREATE TABLE IF NOT EXISTS stats_events (id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, kind TEXT NOT NULL, conversation_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', image_id TEXT, image_name TEXT NOT NULL DEFAULT '', sources TEXT NOT NULL DEFAULT '[]', notification TEXT NOT NULL DEFAULT 'off', notify_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0)`,
      `CREATE INDEX IF NOT EXISTS stats_time ON stats_events(created_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS stats_visitor ON stats_events(visitor_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS stats_conversation ON stats_events(conversation_id)`,
      `CREATE INDEX IF NOT EXISTS stats_image ON stats_events(image_id)`,
      `CREATE TABLE IF NOT EXISTS stats_images (id TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id, part))`,
      `CREATE TABLE IF NOT EXISTS stats_fragments (event_id TEXT NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, PRIMARY KEY(event_id, id))`,
      `CREATE TABLE IF NOT EXISTS stats_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS stats_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    ]) this.query(sql);
  }
  private parse(row: Record<string, unknown>): Activity {
    return {
      id: String(row.id), visitorId: String(row.visitor_id), visitorName: String(row.visitor_name || ''),
      kind: row.kind as ActivityKind, conversationId: String(row.conversation_id),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), status: row.status as Activity['status'],
      text: String(row.text), answer: String(row.answer), error: String(row.error),
      imageId: row.image_id ? String(row.image_id) : null, imageName: String(row.image_name),
      sources: JSON.parse(String(row.sources)), notification: row.notification as Activity['notification'],
    };
  }
  origin() { return this.query("SELECT value FROM stats_metadata WHERE key = 'origin'")[0]?.value as string | undefined; }
  rememberOrigin(origin: string) { this.query("INSERT INTO stats_metadata(key, value) VALUES ('origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", origin); }
  event(id: string, detail = false): Activity | undefined {
    const row = this.query('SELECT e.*, v.name AS visitor_name FROM stats_events e JOIN stats_visitors v ON v.id = e.visitor_id WHERE e.id = ?', id)[0];
    if (!row) return;
    const event = this.parse(row);
    if (detail && event.kind === 'live') event.fragments = this.fragments(id, event.conversationId);
    return event;
  }
  create(event: StoredActivity, image?: string) {
    return this.transaction(() => {
      if (this.event(event.id)) return false;
      this.query('INSERT OR IGNORE INTO stats_visitors(id) VALUES (?)', event.visitorId);
      if (image && event.imageId && !this.query('SELECT 1 FROM stats_images WHERE id = ? LIMIT 1', event.imageId).length) {
        // Cloudflare SQLite rows have a size limit. Keep even the largest accepted
        // photo below it without requiring an additional bucket or public URL.
        for (let offset = 0; offset < image.length; offset += 500_000) {
          this.query('INSERT INTO stats_images(id, part, data) VALUES (?, ?, ?)', event.imageId, offset / 500_000, image.slice(offset, offset + 500_000));
        }
      }
      this.query(`INSERT INTO stats_events(id, visitor_id, kind, conversation_id, created_at, updated_at, status, text, answer, error, image_id, image_name, sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.id, event.visitorId, event.kind, event.conversationId, event.createdAt, event.updatedAt, event.status, event.text, event.answer, event.error, event.imageId, event.imageName, JSON.stringify(event.sources));
      return true;
    });
  }
  update(id: string, values: { status?: Activity['status']; answer?: string; error?: string; sources?: Activity['sources'] }) {
    const columns: string[] = ['updated_at = ?'];
    const params: Value[] = [Date.now()];
    for (const [key, value] of Object.entries(values)) {
      columns.push(`${key} = ?`);
      params.push(key === 'sources' ? JSON.stringify(value) : String(value));
    }
    this.query(`UPDATE stats_events SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
  }
  image(id: string) {
    const rows = this.query('SELECT data FROM stats_images WHERE id = ? ORDER BY part', id);
    return rows.length ? rows.map(row => row.data).join('') : undefined;
  }
  fragments(id: string, session: string): TranscriptFragment[] {
    return this.query('SELECT * FROM stats_fragments WHERE event_id = ? ORDER BY start, end, rowid', id).map(row => ({
      id: String(row.id), session, role: row.role as 'user' | 'assistant', text: String(row.text), start: Number(row.start), end: Number(row.end),
    }));
  }
  append(id: string, fragments: TranscriptFragment[]) {
    return this.transaction(() => {
      const usage = this.query('SELECT COUNT(*) AS count, COALESCE(SUM(length(text)), 0) AS size FROM stats_fragments WHERE event_id = ?', id)[0];
      if (Number(usage.count) + fragments.length > 10_000 || Number(usage.size) + fragments.reduce((sum, fragment) => sum + fragment.text.length, 0) > 250_000) throw new Error('Caption storage limit');
      let inserted = 0;
      for (const fragment of fragments) {
        inserted += this.query('INSERT OR IGNORE INTO stats_fragments(event_id, id, role, text, start, end) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', id, fragment.id, fragment.role, fragment.text, fragment.start, fragment.end).length;
      }
      if (inserted) {
        // The searchable summary is separate from timestamped fragments, which
        // remain available intact in the conversation detail.
        const rows = this.query('SELECT role, group_concat(text, \'\') AS text FROM (SELECT role, text FROM stats_fragments WHERE event_id = ? ORDER BY start, end, rowid) GROUP BY role', id);
        const joined = (role: string) => String(rows.find(row => row.role === role)?.text || '');
        this.query('UPDATE stats_events SET text = ?, answer = ?, updated_at = ? WHERE id = ?', joined('user'), joined('assistant'), Date.now(), id);
      }
      return inserted > 0;
    });
  }
  rename(id: string, name: string) {
    return this.query('UPDATE stats_visitors SET name = ? WHERE id = ? RETURNING id', name, id).length > 0;
  }
  list(filters: StatsFilters): Omit<StatsPage, 'retentionDays' | 'ntfyConfigured'> {
    const clauses: string[] = [];
    const params: Value[] = [];
    if (filters.kind) { clauses.push('e.kind = ?'); params.push(filters.kind); }
    if (filters.visitor) { clauses.push('e.visitor_id = ?'); params.push(filters.visitor); }
    if (filters.conversation) { clauses.push('e.conversation_id = ?'); params.push(filters.conversation); }
    if (filters.from) { clauses.push('e.created_at >= ?'); params.push(filters.from); }
    if (filters.to) { clauses.push('e.created_at < ?'); params.push(filters.to); }
    if (filters.q) {
      clauses.push("(e.text LIKE ? ESCAPE '\\' OR e.answer LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\' OR e.image_name LIKE ? ESCAPE '\\')");
      const term = `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`;
      params.push(term, term, term, term);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const from = ' FROM stats_events e JOIN stats_visitors v ON v.id = e.visitor_id';
    const total = Number(this.query(`SELECT COUNT(*) AS count${from}${where}`, ...params)[0].count);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(filters.page, pages);
    const events = this.query(`SELECT e.*, v.name AS visitor_name${from}${where} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`, ...params, PAGE_SIZE, (page - 1) * PAGE_SIZE).map(row => {
      const event = this.parse(row);
      return { ...event, text: event.text.slice(0, 500), answer: event.answer.slice(0, 700), sources: [] };
    });
    const counts = { question: 0, photo: 0, live: 0, dictation: 0, speech: 0 };
    for (const row of this.query(`SELECT e.kind, COUNT(*) AS count${from}${where} GROUP BY e.kind`, ...params)) counts[row.kind as ActivityKind] = Number(row.count);
    const visitors = this.query('SELECT v.id, v.name, COUNT(e.id) AS count, MAX(e.updated_at) AS last_seen FROM stats_visitors v JOIN stats_events e ON e.visitor_id = v.id GROUP BY v.id ORDER BY last_seen DESC').map(row => ({ id: String(row.id), name: String(row.name), count: Number(row.count), lastSeen: Number(row.last_seen) } satisfies StatsVisitor));
    const notificationFailures = Number(this.query("SELECT COUNT(*) AS count FROM stats_events WHERE notification = 'failed'")[0].count);
    return { events, total, page, pages, counts, visitors, notificationFailures };
  }
  notify(id: string, delay = 0) {
    const at = Date.now() + delay;
    this.query("UPDATE stats_events SET notification = 'pending', notify_at = MIN(COALESCE(notify_at, ?), ?), attempts = 0, revision = revision + 1 WHERE id = ?", at, at, id);
  }
  notifications() {
    return this.query('SELECT id, revision, attempts FROM stats_events WHERE notify_at <= ? ORDER BY notify_at LIMIT 10', Date.now()).map(row => ({ id: String(row.id), revision: Number(row.revision), attempts: Number(row.attempts) }));
  }
  notified(id: string, revision: number, attempts: number, success: boolean) {
    if (success) this.query("UPDATE stats_events SET notification = CASE WHEN revision = ? THEN 'sent' ELSE 'pending' END, notify_at = CASE WHEN revision = ? THEN NULL ELSE ? END, attempts = 0 WHERE id = ?", revision, revision, Date.now() + 15_000, id);
    else this.query("UPDATE stats_events SET notification = 'failed', notify_at = ?, attempts = ? WHERE id = ? AND revision = ?", attempts >= 5 ? null : Date.now() + Math.min(600_000, 30_000 * 2 ** (attempts - 1)), attempts, id, revision);
  }
  nextNotification() { return this.query('SELECT MIN(notify_at) AS at FROM stats_events')[0].at as number | null; }
  retryNotifications() { this.query("UPDATE stats_events SET notify_at = ?, attempts = 0, notification = 'pending' WHERE notification = 'failed'", Date.now()); }
  allowLogin(id: string) {
    return this.transaction(() => {
      this.query('DELETE FROM stats_limits WHERE expires <= ?', Date.now());
      this.query('INSERT INTO stats_limits(id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1', id, Date.now() + 10 * 60_000);
      return Number(this.query('SELECT count FROM stats_limits WHERE id = ?', id)[0].count) <= 10;
    });
  }
  prune(days: number) {
    this.transaction(() => {
      this.query('DELETE FROM stats_events WHERE updated_at < ?', Date.now() - days * 86400_000);
      this.query('DELETE FROM stats_fragments WHERE event_id NOT IN (SELECT id FROM stats_events)');
      this.query('DELETE FROM stats_images WHERE id NOT IN (SELECT image_id FROM stats_events WHERE image_id IS NOT NULL)');
      this.query('DELETE FROM stats_limits WHERE expires <= ?', Date.now());
    });
  }
}
