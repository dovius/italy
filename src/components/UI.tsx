import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, Check, CircleAlert, LoaderCircle, Mic, Send, Square, Volume2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Message, TranscriptRow } from '../../shared/types';
import { useRecorder } from '../hooks/useRecorder';

export function Notice({ children, retry, onDismiss }: { children: ReactNode; retry?: () => void; onDismiss?: () => void }) {
  return <div className="notice" role="alert"><CircleAlert size={23} className="shrink" /><div>{children}{retry && <button className="text-button notice-retry" onClick={retry}>Pabandyti dar kartą <span aria-hidden="true">↗</span></button>}</div>{onDismiss && <button className="icon-button" aria-label="Uždaryti pranešimą" onClick={onDismiss}><X size={20} /></button>}</div>;
}
export function ScreenHeader({ eyebrow, title, description, onBack }: { eyebrow: string; title: string; description: string; onBack: () => void }) {
  return <div className="screen-heading"><button className="back-button" onClick={onBack}><ArrowLeft size={21} /> Į pradžią</button><span className="eyebrow">{eyebrow}</span><h1 tabIndex={-1}>{title}</h1><p>{description}</p></div>;
}
export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-inner"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" autoFocus onClick={onClose} aria-label="Uždaryti"><X size={26} /></button></div>{children}</div></dialog>;
}
export function ShowTranslation({ text, onClose, onSpeak, audioBusy, audioBlocked, audioError, resume }: { text: string; onClose: () => void; onSpeak: (text: string) => void; audioBusy: boolean; audioBlocked: boolean; audioError: string; resume: () => void }) {
  return <Modal title="Vertimas · Traduzione" onClose={onClose} className="translation-modal"><div className="translation-display"><span className="eyebrow">PARODYKITE PAŠNEKOVUI</span><p>{text}</p></div>{audioError && <Notice>{audioError}</Notice>}<div className="translation-controls"><button className="button secondary" disabled={audioBusy && !audioBlocked} onClick={() => audioBlocked ? resume() : onSpeak(text)}>{audioBusy && !audioBlocked ? <LoaderCircle className="spin" size={24} /> : <Volume2 size={24} />} {audioBlocked ? 'Paleisti garsą' : audioBusy ? 'Ruošiame…' : 'Pakartoti'}</button><button className="button primary" onClick={onClose}><Check size={24} /> Grįžti</button></div></Modal>;
}
export function Composer({ draft, setDraft, onSend, disabled, photo = false }: { draft: string; setDraft: (value: string) => void; onSend: (value: string) => void; disabled: boolean; photo?: boolean }) {
  const recorder = useRecorder((text) => setDraft(draft ? `${draft} ${text}` : text));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [dictated, setDictated] = useState(false);
  useEffect(() => {
    if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(180, textarea.current.scrollHeight)}px`; }
  }, [draft]);
  useEffect(() => { if (recorder.transcribing) setDictated(true); }, [recorder.transcribing]);
  const submit = () => {
    if (!draft.trim() || disabled || recorder.recording || recorder.transcribing) return;
    onSend(draft); setDraft(''); setDictated(false);
  };
  return <div className="composer-wrap">
    {recorder.error && <Notice>{recorder.error}</Notice>}
    {recorder.recording ? <div className="recording-panel" role="status"><span className="recording-dot" /><span>Klausomės… {recorder.seconds} s</span><button className="button primary" onClick={recorder.stop}><Square size={18} fill="currentColor" /> Baigti įrašą</button></div> : <>
      {recorder.transcribing && <div className="composer-status" role="status"><LoaderCircle size={20} className="spin" /> Užrašome jūsų klausimą…</div>}
      {dictated && !recorder.transcribing && draft && <p className="composer-hint">Klausimą galite pataisyti. Tada spauskite „Siųsti“.</p>}
      <form className="composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label className="sr-only" htmlFor={photo ? 'photo-question' : 'assistant-question'}>{photo ? 'Klausimas apie nuotrauką' : 'Jūsų klausimas'}</label>
        <textarea ref={textarea} id={photo ? 'photo-question' : 'assistant-question'} rows={1} maxLength={4000} value={draft} disabled={disabled || recorder.transcribing} onChange={(event) => setDraft(event.target.value)} placeholder={photo ? 'Paklauskite apie šią nuotrauką…' : 'Parašykite savo klausimą…'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.innerWidth > 700) { event.preventDefault(); submit(); } }} />
        <div className="composer-actions"><button type="button" className="dictate-button" disabled={disabled || recorder.transcribing} onClick={() => void recorder.start()}><Mic size={22} /> Kalbėti</button><button type="submit" className="send-button" disabled={!draft.trim() || disabled || recorder.transcribing}><Send size={21} /><span>Siųsti</span></button></div>
      </form>
    </>}
    <p className="composer-hint">{photo ? 'Nuotraukos nereikia siųsti iš naujo.' : 'Galite rašyti arba paspausti mikrofoną.'}</p>
  </div>;
}
export function Conversation({ messages, busy, onSpeak }: { messages: Message[]; busy: boolean; onSpeak: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => { if (nearBottom.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [messages, busy]);
  return <div className="conversation-wrap"><div className="chat-messages" ref={ref} role="log" aria-label="Pokalbis" aria-live="polite" aria-relevant="additions" onScroll={() => { const el = ref.current!; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; setScrolled(!nearBottom.current); }}>
    {messages.map((message) => <article key={message.id} className={`message ${message.role}`}><div className="message-label">{message.role === 'user' ? 'Jūs' : 'Kelionės asistentas'}</div><div className="message-body"><Markdown components={{ a: (props) => <a href={props.href} target="_blank" rel="noreferrer noopener">{props.children}</a>, img: () => null }}>{message.text}</Markdown></div>{message.sources && message.sources.length > 0 && <div className="sources" aria-label="Atsakymo šaltiniai">{message.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer noopener">{source.title} ↗</a>)}</div>}{message.role === 'assistant' && <button className="message-speak" onClick={() => onSpeak(message.text)}><Volume2 size={20} /> Išklausyti</button>}</article>)}
    {busy && <div className="thinking" role="status"><span className="thinking-dots"><i /><i /><i /></span> Ruošiame atsakymą…</div>}
  </div>{scrolled && <button className="latest-button" onClick={() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); nearBottom.current = true; setScrolled(false); }}><ArrowDown size={19} /> Naujausias atsakymas</button>}</div>;
}
export function Captions({ rows }: { rows: TranscriptRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => { if (follow.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [rows]);
  useLayoutEffect(() => {
    const element = ref.current!;
    // Safari/Chrome bars can resize the caption area without adding a transcript row.
    // Follow the newest translation only while the reader has not scrolled into history.
    const observer = new ResizeObserver(() => { if (follow.current) element.scrollTop = element.scrollHeight; });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="caption-wrap"><div className="captions" ref={ref} tabIndex={0} role="log" aria-label="Išgirstas tekstas ir vertimai" aria-live="off" onScroll={() => { const el = ref.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; setScrolled(!follow.current); }}>{rows.map((row) => <article className={`caption ${row.role}`} key={row.id}><span className="caption-label">{row.role === 'user' ? 'Išgirsta' : 'Vertimas'}</span><p>{row.text}</p></article>)}</div>{scrolled && <button className="latest-button" onClick={() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); follow.current = true; setScrolled(false); }}><ArrowDown size={19} /> Naujausias vertimas</button>}</div>;
}
