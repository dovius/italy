import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bell, BellOff, Camera, Check, ChevronLeft, ChevronRight, Clock3, Eye, EyeOff, Headphones, LayoutList, LoaderCircle, LockKeyhole, LogOut, MessageCircle, Mic, Pencil, RefreshCw, Search, ShieldCheck, Users, Volume2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { activityLabels, visitorLabel, type Activity, type ActivityKind, type StatsPage, type StatsVisitor } from '../../shared/stats';
import { groupTranscripts } from '../lib/transcripts';
import { LogoMark } from './Illustrations';
import { Modal } from './UI';
import '../stats.css';

const icons = { question: MessageCircle, photo: Camera, live: Headphones, dictation: Mic, speech: Volume2 };
const navigation: { kind: ActivityKind | ''; label: string; Icon: typeof Camera }[] = [
  { kind: '', label: 'Visa veikla', Icon: LayoutList }, { kind: 'photo', label: 'Nuotraukos', Icon: Camera },
  { kind: 'question', label: 'Klausimai', Icon: MessageCircle }, { kind: 'live', label: 'Balso pokalbiai', Icon: Headphones },
  { kind: 'dictation', label: 'Diktavimas', Icon: Mic }, { kind: 'speech', label: 'Skaitymas balsu', Icon: Volume2 },
];
const dateTime = (value: number) => new Intl.DateTimeFormat('lt-LT', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
const time = (value: number) => new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);
const duration = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
class StatsError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal || AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
    throw new StatsError(data.error || 'Nepavyko gauti duomenų. Pabandykite dar kartą.', response.status, data.code);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
const errorText = (error: unknown) => error instanceof StatsError ? error.message : 'Nepavyko pasiekti serverio. Patikrinkite ryšį ir bandykite dar kartą.';

export default function Stats() {
  const [access, setAccess] = useState<'checking' | 'login' | 'ready' | 'unconfigured'>('checking');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<StatsPage | null>(null);
  const [updated, setUpdated] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [kind, setKind] = useState<ActivityKind | ''>('');
  const [visitor, setVisitor] = useState('');
  const [conversation, setConversation] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(location.search).get('event'));
  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailError, setDetailError] = useState('');
  const [editing, setEditing] = useState<StatsVisitor | null>(null);
  const [name, setName] = useState('');
  const [editError, setEditError] = useState('');
  const initial = useRef(true);
  const authEpoch = useRef(0);

  function expired() { authEpoch.current++; setAccess('login'); setData(null); setDetail(null); setEditing(null); setError(''); }
  useEffect(() => {
    document.title = 'Kelionės istorija · Administravimas';
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex, nofollow'; document.head.appendChild(robots);
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { setData(null); setDetail(null); setAccess('checking'); setRefresh(value => value + 1); } };
    window.addEventListener('pageshow', restored);
    return () => { robots.remove(); window.removeEventListener('pageshow', restored); };
  }, []);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);

  useEffect(() => {
    if (access === 'login' || access === 'unconfigured') return;
    const controller = new AbortController();
    const epoch = authEpoch.current;
    let fetching = false;
    async function load() {
      if (fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      const params = new URLSearchParams({ kind, visitor, conversation, q: query, page: String(page) });
      if (from) params.set('from', String(new Date(`${from}T00:00:00`).getTime()));
      if (to) { const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1); params.set('to', String(end.getTime())); }
      try {
        const result = await api<StatsPage>(`/api/stats?${params}`, undefined, controller.signal);
        if (!controller.signal.aborted && epoch === authEpoch.current) { setData(result); setAccess('ready'); setUpdated(Date.now()); setError(''); initial.current = false; }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof StatsError && cause.status === 401) expired();
        else if (cause instanceof StatsError && cause.code === 'stats_not_configured') { setAccess('unconfigured'); setError(cause.message); }
        else { setError(errorText(cause)); if (initial.current) setAccess('checking'); }
      } finally { fetching = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 15_000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [kind, visitor, conversation, query, from, to, page, refresh, access]);

  useEffect(() => {
    if (!selected || access !== 'ready') return;
    const controller = new AbortController();
    setDetail(null); setDetailError('');
    async function load() {
      try {
        const event = await api<Activity>(`/api/stats/events/${encodeURIComponent(selected!)}`, undefined, controller.signal);
        if (!controller.signal.aborted) { setDetail(event); setDetailError(''); }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof StatsError && cause.status === 401) expired();
        else setDetailError(errorText(cause));
      }
    }
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected, access, refresh]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/stats/login', { password }); setPassword(''); setAccess('checking'); setRefresh(value => value + 1); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await api('/api/stats/logout', {}); expired(); setSelected(null); history.replaceState(null, '', '/stats'); }
    catch (cause) { if (cause instanceof StatsError && cause.status === 401) expired(); else setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  function filterKind(value: ActivityKind | '') { setKind(value); setConversation(''); setPage(1); }
  function filterVisitor(value: string) { setVisitor(value); setPage(1); }
  function clearFilters() { setKind(''); setVisitor(''); setConversation(''); setSearch(''); setQuery(''); setFrom(''); setTo(''); setPage(1); }
  function openDetail(id: string) { setSelected(id); history.replaceState(null, '', `/stats?event=${encodeURIComponent(id)}`); }
  function closeDetail() { setSelected(null); setDetail(null); history.replaceState(null, '', '/stats'); }
  function edit(person: StatsVisitor) { setEditing(person); setName(person.name); setEditError(''); }
  async function saveName(event: FormEvent) {
    event.preventDefault(); if (!editing) return; setBusy(true); setEditError('');
    try { await api(`/api/stats/visitors/${editing.id}`, { name }); setEditing(null); setRefresh(value => value + 1); }
    catch (cause) { if (cause instanceof StatsError && cause.status === 401) expired(); else setEditError(errorText(cause)); }
    finally { setBusy(false); }
  }
  async function retryNotifications() {
    setBusy(true);
    try { await api('/api/stats/notifications/retry', {}); setRefresh(value => value + 1); }
    catch (cause) { if (cause instanceof StatsError && cause.status === 401) expired(); else setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  if (access !== 'ready' || !data) return <main className="stats-login"><div className="stats-login-brand"><LogoMark /><span>Kelionės vertėjas</span></div><div className="stats-login-card"><span className="stats-lock"><LockKeyhole size={26} /></span><p className="stats-eyebrow">TIK ORGANIZATORIUI</p><h1>Kelionės istorija</h1><p>Nuotraukos, klausimai ir pokalbiai.<br />Viskas vienoje vietoje.</p>{access === 'login' ? <form onSubmit={login}><label htmlFor="stats-password">Administratoriaus slaptažodis</label><div className="stats-password"><input id="stats-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={2000} value={password} onChange={event => setPassword(event.target.value)} autoFocus /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Slėpti slaptažodį' : 'Rodyti slaptažodį'}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>{error && <p className="stats-error" role="alert">{error}</p>}<button className="stats-primary" disabled={busy}>{busy ? <LoaderCircle size={19} className="spin" /> : <ArrowUpRight size={19} />} {busy ? 'Jungiamės…' : 'Prisijungti'}</button></form> : <div className="stats-login-status">{error ? <><p className="stats-error" role="alert">{error}</p><button className="stats-button" onClick={() => { setAccess('checking'); setRefresh(value => value + 1); }}><RefreshCw size={17} /> Bandyti dar kartą</button></> : <p role="status"><LoaderCircle className="spin" size={21} /> Tikriname prisijungimą…</p>}</div>}<span className="stats-login-note"><ShieldCheck size={15} /> Privati kelionės erdvė</span></div></main>;

  const filtered = Boolean(kind || visitor || conversation || query || from || to);
  return <div className="stats-shell"><a className="skip-link" href="#stats-main">Pereiti prie istorijos</a><aside className="stats-sidebar"><div className="stats-brand"><LogoMark /><div>Kelionės vertėjas<small>ADMINISTRAVIMAS</small></div></div><p className="stats-nav-label">KELIONĖS APŽVALGA</p><nav aria-label="Veiklos tipas">{navigation.map(({ kind: value, label, Icon }) => <button key={value} className={kind === value ? 'selected' : ''} aria-pressed={kind === value} onClick={() => filterKind(value)}><Icon size={19} /><span>{label}</span>{kind === value && <span className="stats-nav-dot" />}</button>)}</nav><div className="stats-people"><p className="stats-nav-label">KELIAUTOJAI <span>{data.visitors.length}</span></p>{data.visitors.length ? data.visitors.map(person => <div className={`stats-person ${visitor === person.id ? 'selected' : ''}`} key={person.id}><button onClick={() => filterVisitor(visitor === person.id ? '' : person.id)} aria-pressed={visitor === person.id}><span className="stats-avatar">{visitorLabel(person.id, person.name).slice(0, 1)}</span><span>{visitorLabel(person.id, person.name)}</span></button><button className="stats-person-edit" aria-label={`Pervadinti: ${visitorLabel(person.id, person.name)}`} onClick={() => edit(person)}><Pencil size={14} /></button></div>) : <p className="stats-people-empty">Čia atsiras keliautojai, kai pradės naudotis vertėju.</p>}</div><div className="stats-sidebar-bottom"><span><ShieldCheck size={16} /> Tik administratoriui</span><button disabled={busy} onClick={() => void logout()}><LogOut size={17} /> Atsijungti</button></div></aside>
    <main id="stats-main" className="stats-main"><header className="stats-topbar"><span><span className="italian-flag" /> ITALIJA · KELIONĖS ISTORIJA</span><span className={`stats-ntfy ${data.notificationFailures ? 'has-errors' : ''}`}>{data.ntfyConfigured ? <Bell size={15} /> : <BellOff size={15} />}{data.ntfyConfigured ? data.notificationFailures ? 'ntfy · yra neišsiųstų' : 'ntfy įjungta' : 'ntfy neįjungta'}</span></header><div className="stats-heading"><div><p className="stats-eyebrow">VISKAS, KAS VYKSTA KELIONĖJE</p><h1>Kelionės istorija</h1><p>Kas klausė, ką siuntė ir kaip atsakė vertėjas.</p></div><button className="stats-button" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} /> Atnaujinti</button></div>
      <div className="stats-metrics"><Metric label="Veiklos įrašai" value={data.total} Icon={LayoutList} tone="rust" /><Metric label="Keliautojai iš viso" value={data.visitors.length} Icon={Users} tone="olive" /><Metric label="Nuotraukų užklausos" value={data.counts.photo} Icon={Camera} tone="sand" /><Metric label="Balso pokalbiai" value={data.counts.live} Icon={Headphones} tone="blue" /></div>
      {error && <div className="stats-error stats-banner" role="alert">{error}</div>}{data.notificationFailures > 0 && <div className="stats-notification-warning" role="status"><BellOff size={19} /><p>Nepavyko išsiųsti {data.notificationFailures} pranešimų. Istorija išsaugota; pranešimus bandysime siųsti dar kartą.</p><button disabled={busy} onClick={() => void retryNotifications()}>Pakartoti dabar</button></div>}
      <section className="stats-feed" aria-labelledby="stats-feed-title"><div className="stats-feed-heading"><h2 id="stats-feed-title">{conversation ? 'Pasirinkto pokalbio istorija' : navigation.find(item => item.kind === kind)?.label}</h2><span className="stats-updated"><span className="mini-dot" /> Atnaujinta {time(updated)}</span></div><div className="stats-filters"><label className="stats-search"><Search size={18} /><span className="sr-only">Ieškoti istorijoje</span><input type="search" maxLength={200} placeholder="Ieškoti žinutės, atsakymo ar vardo…" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="stats-select"><span className="sr-only">Keliautojas</span><select value={visitor} onChange={event => filterVisitor(event.target.value)}><option value="">Visi keliautojai</option>{data.visitors.map(person => <option value={person.id} key={person.id}>{visitorLabel(person.id, person.name)}</option>)}</select></label><label className="stats-date">Nuo<input type="date" aria-label="Nuo datos" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label className="stats-date">Iki<input type="date" aria-label="Iki datos" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1); }} /></label></div>{filtered && <div className="stats-filter-summary"><span>Pagal filtrus: {data.total}</span>{visitor && <button onClick={() => { const person = data.visitors.find(person => person.id === visitor); if (person) edit(person); }}><Pencil size={13} /> Keisti vardą</button>}<button onClick={clearFilters}><X size={14} /> Išvalyti filtrus</button></div>}
        {data.events.length ? <div className="stats-event-list">{data.events.map(event => <EventCard key={event.id} event={event} open={() => openDetail(event.id)} person={() => filterVisitor(event.visitorId)} />)}</div> : <div className="stats-empty"><span><LayoutList size={30} strokeWidth={1.5} /></span><h3>{filtered ? 'Tokių įrašų nėra' : 'Kelionės istorija prasideda čia'}</h3><p>{filtered ? 'Pabandykite kitą paiešką arba pasirinkite platesnį laikotarpį.' : 'Kai keliautojas atsiųs nuotrauką, užduos klausimą ar pradės pokalbį, jo veiklą matysite čia.'}</p>{filtered && <button className="stats-button" onClick={clearFilters}>Rodyti visą veiklą</button>}</div>}
        {data.pages > 1 && <div className="stats-pagination"><span>{data.page} / {data.pages} puslapis · {data.total} įrašų</span><div><button className="stats-button" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} aria-label="Ankstesnis puslapis"><ChevronLeft size={18} /></button><button className="stats-button" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)} aria-label="Kitas puslapis"><ChevronRight size={18} /></button></div></div>}
      </section><footer className="stats-footer"><span><LockKeyhole size={14} /> Istorija saugoma {data.retentionDays} d. nuo paskutinio įrašo atnaujinimo.</span><span>Automatiškai atsinaujina kas 15 s</span></footer>
    </main>
    {selected && <Modal className="stats-detail" title={detail ? activityLabels[detail.kind] : 'Veiklos įrašas'} onClose={closeDetail}>{detailError ? <p role="alert" className="stats-error">{detailError}</p> : detail ? <ActivityDetail event={detail} conversation={() => { setConversation(detail.conversationId); setVisitor(detail.visitorId); setKind(''); setQuery(''); setSearch(''); setFrom(''); setTo(''); setPage(1); closeDetail(); }} /> : <p className="stats-detail-loading" role="status"><LoaderCircle className="spin" size={23} /> Atveriame įrašą…</p>}</Modal>}
    {editing && <Modal title="Keliautojo vardas" className="stats-edit-modal" onClose={() => setEditing(null)}><p className="stats-edit-note">Šis vardas bus rodomas prie visų šios naršyklės veiksmų ir naujuose „ntfy“ pranešimuose. Kita naršyklė ar telefonas turės atskirą žymėjimą.</p><form onSubmit={saveName}><label htmlFor="stats-visitor-name">Vardas</label><input id="stats-visitor-name" autoComplete="off" maxLength={80} placeholder={visitorLabel(editing.id)} value={name} onChange={event => setName(event.target.value)} /><small>Naršyklė: {editing.id.slice(0, 12).toUpperCase()}</small>{editError && <p className="stats-error" role="alert">{editError}</p>}<button className="stats-primary" disabled={busy}><Check size={18} /> Išsaugoti vardą</button></form></Modal>}
  </div>;
}

function Metric({ label, value, Icon, tone }: { label: string; value: number; Icon: typeof Camera; tone: string }) {
  return <div className="stats-metric"><div><span>{label}</span><strong>{value.toLocaleString('lt-LT')}</strong></div><span className={`stats-metric-icon ${tone}`}><Icon size={23} strokeWidth={1.6} /></span></div>;
}
function EventCard({ event, open, person }: { event: Activity; open: () => void; person: () => void }) {
  const Icon = icons[event.kind];
  const label = visitorLabel(event.visitorId, event.visitorName);
  return <article className={`stats-event ${event.kind}`}><span className={`stats-event-icon ${event.kind}`}><Icon size={20} /></span><div className="stats-event-content"><div className="stats-event-meta"><button className="stats-event-person" onClick={person}>{label}</button><span className={`stats-kind ${event.kind}`}>{activityLabels[event.kind]}</span>{event.status === 'active' && <span className="stats-live-status"><span className="mini-dot" /> Vyksta</span>}<time dateTime={new Date(event.createdAt).toISOString()}>{dateTime(event.createdAt)}</time></div><div className={`stats-event-preview ${event.imageId ? 'with-photo' : ''}`}>{event.imageId && <button className="stats-thumbnail" onClick={open} aria-label={`Peržiūrėti nuotrauką: ${event.imageName || label}`}><img src={`/api/stats/images/${event.imageId}`} alt={event.imageName || 'Siųsta nuotrauka'} loading="lazy" /></button>}<div>{event.text ? <p className="stats-question">{event.text}</p> : <p className="stats-placeholder">{event.kind === 'live' ? 'Pradėtas balso pokalbis' : 'Laukiame teksto…'}</p>}{event.answer && <div className="stats-answer"><ArrowDownLeft size={16} /><p>{event.answer}</p></div>}{event.status === 'pending' && <p className="stats-pending"><LoaderCircle size={14} className="spin" /> Laukiame atsakymo</p>}{event.error && <p className="stats-event-error">{event.error}</p>}</div></div><div className="stats-event-bottom"><span>{event.notification === 'sent' ? <><Check size={13} /> ntfy išsiųsta</> : event.notification === 'failed' ? <><BellOff size={13} /> ntfy nepavyko</> : event.notification === 'pending' ? <><Clock3 size={13} /> ntfy eilėje</> : null}</span><button onClick={open}>Visas įrašas <ArrowUpRight size={15} /></button></div></div></article>;
}
function ActivityDetail({ event, conversation }: { event: Activity; conversation: () => void }) {
  const person = visitorLabel(event.visitorId, event.visitorName);
  const rows = event.fragments ? groupTranscripts(event.fragments) : [];
  return <div className="stats-detail-content"><div className="stats-detail-meta"><span className="stats-avatar">{person.slice(0, 1)}</span><strong>{person}</strong><time>{dateTime(event.createdAt)}</time></div>{event.imageId && <figure className="stats-full-photo"><a href={`/api/stats/images/${event.imageId}`} target="_blank" rel="noreferrer"><img src={`/api/stats/images/${event.imageId}`} alt={event.imageName || 'Keliautojo siųsta nuotrauka'} /></a><figcaption>{event.imageName || 'Siųsta nuotrauka'} · Paspauskite norėdami padidinti</figcaption></figure>}{event.kind === 'live' ? <><p className="stats-detail-explanation">Mikrofonu išgirstas tekstas ir vertėjo ištarti atsakymai. Laikas skaičiuojamas nuo pokalbio pradžios.</p><div className="stats-transcripts">{rows.map(row => <section className={`stats-transcript ${row.role}`} key={row.id}><div><span>{row.role === 'user' ? `${person} · išgirsta` : 'Vertėjas · atsakymas'}</span><time>{duration(row.start)}</time></div><p>{row.text}</p></section>)}</div>{!rows.length && <p className="stats-placeholder">Šio pokalbio teksto dar negavome.</p>}</> : <><section className="stats-detail-message"><h3><ArrowUpRight size={16} /> {event.kind === 'dictation' ? `${person} · diktuotas tekstas` : event.kind === 'speech' ? `${person} · perskaityta balsu` : `${person} → asistentas`}</h3><p>{event.text}</p>{event.kind === 'dictation' && <small>Tekstas prieš peržiūrą ir išsiuntimą.</small>}</section>{event.answer && <section className="stats-detail-message is-answer"><h3><ArrowDownLeft size={16} /> Asistentas → {person}</h3><div className="stats-markdown"><Markdown components={{ a: props => <a href={props.href} target="_blank" rel="noreferrer">{props.children}</a>, img: () => null }}>{event.answer}</Markdown></div>{event.sources.length > 0 && <div className="sources">{event.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div>}</section>}</>}{event.error && <p role="alert" className="stats-error">{event.error}</p>}{['question', 'photo'].includes(event.kind) && <button className="stats-button stats-conversation-link" onClick={conversation}><MessageCircle size={17} /> Visi šio pokalbio klausimai</button>}</div>;
}
