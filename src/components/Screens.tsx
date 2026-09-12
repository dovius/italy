import { useRef, type ChangeEvent, type CSSProperties } from 'react';
import { ArrowRight, Camera, Check, CircleCheck, Eye, ImagePlus, LoaderCircle, MessageCircle, Mic, MicOff, ParkingCircle, PhoneOff, TrainFront, Utensils, Volume2 } from 'lucide-react';
import type { Message, PhotoContext, TranscriptRow } from '../../shared/types';
import type { LiveStatus } from '../lib/live';
import type { ListeningStopReason, ListeningWarning } from '../lib/listeningGuard';
import type { useChat } from '../hooks/useChat';
import { Captions, Composer, Conversation, Modal, Notice, ScreenHeader } from './UI';
import { PhotoIllustration } from './Illustrations';

type ChatController = ReturnType<typeof useChat>;

export function ListeningWarningDialog({ warning, onContinue, onEnd }: { warning: ListeningWarning; onContinue: () => void; onEnd: () => void }) {
  return <Modal title="Ar dar kalbatės?" className="listening-warning" onClose={onEnd} dismissible={false}>
    <p className="modal-lead">{warning.reason === 'silence' ? 'Kurį laiką negirdime kalbos.' : 'Pokalbis trunka beveik 10 minučių.'}</p>
    <p className="listening-countdown">Mikrofonas išsijungs po <strong>{warning.seconds} s</strong></p>
    <div className="listening-actions"><button className="button primary" autoFocus onClick={onContinue}><Mic size={23} aria-hidden="true" /> Tęsti pokalbį</button><button className="button secondary" onClick={onEnd}><PhoneOff size={22} aria-hidden="true" /> Baigti pokalbį</button></div>
  </Modal>;
}

export function LiveScreen({ status, error, stopReason, level, rows, muted, blocked, elapsed, onBack, start, end, play, speak, show }: {
  status: LiveStatus; error: string; stopReason: ListeningStopReason | null; level: number; rows: TranscriptRow[]; muted: boolean; blocked: boolean; elapsed: number;
  onBack: () => void; start: () => void; end: () => void; play: () => void; speak: (text: string) => void; show: (text: string) => void;
}) {
  const active = ['connecting', 'connected', 'reconnecting'].includes(status);
  const listening = status === 'connected' && !muted && !blocked;
  const last = [...rows].reverse().find((row) => row.role === 'assistant');
  const clock = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  // Readiness is confirmed by the live session, not inferred from microphone volume.
  const stoppedHint = stopReason === 'silence' ? '2 minutes negirdėjome kalbos.' : stopReason === 'duration' ? 'Praėjo 10 minučių. Galite tęsti pokalbį.' : 'Išėjus iš vertėjo, pokalbis sustabdomas.';
  const stateText = status === 'connecting' ? 'Jungiamės…' : status === 'reconnecting' ? 'Atkuriame ryšį…' : status === 'connected' && blocked ? 'Įjunkite garsą' : muted && active ? 'Mikrofonas pristabdytas' : status === 'connected' ? 'Galite kalbėti' : status === 'ended' ? stopReason ? 'Mikrofonas išjungtas' : 'Ačiū už pokalbį.' : status === 'error' ? 'Nepavyko prisijungti.' : 'Pasiruošę kalbėtis?';
  const stateHint = status === 'connecting' ? 'Jei telefonas paprašys mikrofono, pasirinkite „Leisti“.' : status === 'reconnecting' ? 'Palaukite. Pokalbis tęsis, kai grįš ryšys.' : muted && active ? 'Baigę klausytis vertimo galėsite kalbėti toliau.' : status === 'connected' && blocked ? 'Paspauskite žemiau, kad girdėtumėte vertimą.' : status === 'connected' ? 'Kalbėkite lietuviškai. Išversime abiem pusėms.' : status === 'ended' ? stopReason ? stoppedHint : 'Galite tęsti tą patį pokalbį.' : 'Paspauskite „Pradėti pokalbį“.';
  const connectionText = status === 'connected' ? 'Prisijungta' : status === 'connecting' ? 'Ruošiame vertėją' : status === 'reconnecting' ? 'Ryšys nutrūko' : status === 'ended' ? 'Pokalbis baigtas' : status === 'error' ? 'Neprisijungta' : 'Gyvas vertėjas';
  return <main className="tool-page live-page" id="main-content" data-status={status}><ScreenHeader eyebrow="GYVAS VERTĖJAS" title="Kalbėtis" description="Jūs kalbate. Mes išverčiame balsu." onBack={onBack} /><div className="language-strip"><span><span className="lithuanian-flag" aria-hidden="true" /> Lietuvių</span><span className="language-arrows" aria-hidden="true">⇄</span><span><span className="italian-flag" aria-hidden="true" /> Italų</span></div>
    {error && status !== 'reconnecting' && <Notice retry={!active ? start : undefined}>{error}</Notice>}
    <section className={`live-stage ${listening ? 'is-live' : ''}`} aria-label="Pokalbio būsena">
      <div className="live-stage-heading">
        <div className="live-orb" aria-hidden="true">{status === 'connecting' || status === 'reconnecting' ? <LoaderCircle className="spin" size={34} /> : muted || status === 'ended' || status === 'error' ? <MicOff size={34} strokeWidth={1.7} /> : <Mic size={34} strokeWidth={1.7} />}</div>
        <div className="live-stage-copy"><div className="live-stage-top"><span className={`connection-label ${status === 'connected' ? 'connected' : ''}`}>{status === 'connected' && <CircleCheck size={18} aria-hidden="true" />}{connectionText}</span>{status === 'connected' && <span className="call-clock" aria-label={`Pokalbio trukmė ${clock}`}>{clock}</span>}</div><h2 aria-live="polite">{stateText}</h2></div>
      </div>
      <p>{stateHint}</p>
      {listening && <div className="live-listening"><span>Klausomės</span><div className="sound-wave" aria-hidden="true">{Array.from({ length: 23 }, (_, index) => <i key={index} style={{ '--bar-height': `${10 + (Math.sin(index * 0.8) * 0.5 + 0.5) * 4 + (8 + (Math.sin(index * 1.8) * 0.5 + 0.5) * 18) * level}px`, '--bar-delay': `${index * -0.11}s` } as CSSProperties} />)}</div></div>}
      {!active && <button className="button primary large" onClick={start}><Mic size={24} />{status === 'ended' ? 'Tęsti pokalbį' : 'Pradėti pokalbį'}</button>}
      {blocked && active && <button className="button primary" onClick={play}><Volume2 size={23} /> Įjungti garsą</button>}
    </section>
    {rows.length > 0 ? <section className="transcript-section"><div className="section-intro"><h2>Pokalbio tekstas</h2><span>Išgirsta ir išversta</span></div><Captions rows={rows} /></section> : <div className="empty-transcript"><MessageCircle size={24} /><p>Čia matysite, kas pasakyta ir kaip išversta.</p></div>}
    {(last || active) && <div className="live-controls">
      {last && <div className="translation-actions"><button className="button secondary" onClick={() => speak(last.text)}><Volume2 size={23} /> Pakartoti</button><button className="button secondary" onClick={() => show(last.text)}><Eye size={23} /> Parodyti žmogui</button></div>}
      {active && <button className="button end-button" onClick={end}><PhoneOff size={22} /> Baigti pokalbį</button>}
    </div>}
    <p className="language-note">Taip pat suprantame anglų ir ispanų kalbas.</p>
    <p className="privacy-note">Balsą verčia dirbtinis intelektas. Galite natūraliai pertraukti.</p>
  </main>;
}

export function PhotoScreen({ photo, chat, selecting, error, draft, setDraft, onBack, onPhoto, speak }: { photo: PhotoContext | null; chat: ChatController; selecting: boolean; error: string; draft: string; setDraft: (value: string) => void; onBack: () => void; onPhoto: (file: File) => void; speak: (text: string) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const change = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) onPhoto(file); event.target.value = ''; };
  return <main className="tool-page photo-page" id="main-content"><ScreenHeader eyebrow="NUOTRAUKOS VERTIMAS" title="Kas čia parašyta?" description="Nufotografuokite. Išversime ir paprastai paaiškinsime." onBack={onBack} />
    <input ref={camera} type="file" accept="image/*" capture="environment" onChange={change} className="sr-only" tabIndex={-1} aria-label="Fotografuoti kamera" /><input ref={upload} type="file" accept="image/*" onChange={change} className="sr-only" tabIndex={-1} aria-label="Pasirinkti nuotraukos failą" />
    {error && <Notice>{error}</Notice>}
    {!photo ? <><div className="photo-upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files[0] && !selecting) onPhoto(event.dataTransfer.files[0]); }}><PhotoIllustration /><h2>{selecting ? 'Ruošiame nuotrauką…' : 'Italija – aiškiau lietuviškai.'}</h2><p>Meniu, kelio ženklas, bilietas ar etiketė.<br />Užtenka vienos nuotraukos.</p><button className="button primary large" onClick={() => camera.current?.click()} disabled={selecting}>{selecting ? <LoaderCircle size={25} className="spin" /> : <Camera size={25} />} {selecting ? 'Ruošiame nuotrauką…' : 'Fotografuoti'}</button><button className="upload-button" onClick={() => upload.current?.click()} disabled={selecting}><ImagePlus size={22} /> Pasirinkti iš nuotraukų</button></div><div className="photo-examples"><span><Utensils size={21} /> Meniu</span><span><ParkingCircle size={21} /> Ženklai</span><span><TrainFront size={21} /> Bilietai</span></div><div className="gentle-note"><Camera size={23} /><p>Telefonas gali paprašyti leidimo naudoti kamerą. Pasirinkite „Leisti“. Visada galite įkelti jau turimą nuotrauką.</p></div></> : <>
      <div className="photo-context"><img src={photo.dataUrl} alt="Jūsų verčiama nuotrauka" /><div><span className="eyebrow">JŪSŲ NUOTRAUKA</span><p><Check size={19} /> Išsaugota šiam pokalbiui</p><div className="photo-change"><button onClick={() => camera.current?.click()} disabled={chat.busy || selecting}><Camera size={19} /> Kita nuotrauka</button><button onClick={() => upload.current?.click()} disabled={chat.busy || selecting} aria-label="Įkelti kitą nuotrauką"><ImagePlus size={21} /></button></div></div></div>
      {selecting && <p className="composer-status" role="status"><LoaderCircle className="spin" size={22} /> Ruošiame nuotrauką…</p>}
      <Conversation messages={photo.messages} busy={chat.busy} onSpeak={speak} />
      {(chat.error || chat.unanswered) && <Notice retry={chat.retry}>{chat.error || 'Šis klausimas dar neturi atsakymo. Galite pabandyti dar kartą.'}</Notice>}
      {photo.messages.some((m) => m.role === 'assistant') && <p className="followup-label">Norite sužinoti daugiau?</p>}
      <Composer photo draft={draft} setDraft={setDraft} onSend={chat.send} disabled={chat.busy || selecting} />
    </>}
    <p className="privacy-note">Nuotrauka išsaugoma šiame telefone. Vertimui ji siunčiama „OpenAI“.</p>
  </main>;
}

const questions = [
  { icon: Utensils, text: 'Kaip paprašyti sąskaitos?' },
  { icon: TrainFront, text: 'Kaip nusipirkti traukinio bilietą?' },
  { icon: MessageCircle, text: 'Ką reiškia „coperto“?' },
  { icon: ParkingCircle, text: 'Kaip paklausti, kur galima statyti?' },
];
export function AssistantScreen({ messages, chat, draft, setDraft, onBack, speak, clear }: { messages: Message[]; chat: ChatController; draft: string; setDraft: (value: string) => void; onBack: () => void; speak: (text: string) => void; clear: () => void }) {
  return <main className="tool-page assistant-page" id="main-content"><ScreenHeader eyebrow="KELIONĖS ASISTENTAS" title="Drąsiai klauskite." description="Apie maistą, transportą ir visa kita Italijoje." onBack={onBack} />
    {!messages.length ? <section className="assistant-welcome"><div className="assistant-symbol"><MessageCircle size={36} strokeWidth={1.6} /><span className="sparkle-small" aria-hidden="true">✧</span></div><h2>Jūsų klausimams – vietos visada yra.</h2><p>Parašykite arba pasakykite, kas rūpi.<br />Atsakysime paprastai, lietuviškai.</p></section> : <><div className="chat-toolbar"><span><span className="mini-dot" /> Jūsų pokalbis</span><button className="text-button" onClick={clear} disabled={chat.busy}>Naujas pokalbis</button></div><Conversation messages={messages} busy={chat.busy} onSpeak={speak} />{(chat.error || chat.unanswered) && <Notice retry={chat.retry}>{chat.error || 'Paskutinis klausimas liko be atsakymo. Galite jį išsiųsti dar kartą.'}</Notice>}</>}
    <Composer draft={draft} setDraft={setDraft} onSend={chat.send} disabled={chat.busy} />
    {!messages.length && <section className="assistant-suggestions"><div className="suggested-label">Galite paklausti</div><div className="question-grid">{questions.map(({ icon: Icon, text }) => <button key={text} onClick={() => chat.send(text)}><Icon size={23} /><span>{text}</span><ArrowRight size={19} /></button>)}</div></section>}
    <p className="privacy-note">Atsakymus kuria dirbtinis intelektas. Svarbias detales pasitikrinkite.</p>
  </main>;
}
