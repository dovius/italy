import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Camera, Check, CircleHelp, Download, Heart, LoaderCircle, MessageCircle, Mic, Smartphone, Square, Volume2, WifiOff, X } from 'lucide-react';
import type { SavedTrip, Screen } from '../shared/types';
import { emptyTrip, readTrip, writeTrip } from './lib/storage';
import { LiveConversation, type LiveStatus } from './lib/live';
import type { ListeningStopReason, ListeningWarning } from './lib/listeningGuard';
import { groupTranscripts } from './lib/transcripts';
import { prepareImage } from './lib/image';
import { useChat } from './hooks/useChat';
import { useSpeech } from './hooks/useSpeech';
import { useNetwork } from './hooks/useNetwork';
import { LogoMark } from './components/Illustrations';
import { Home } from './components/Home';
import { AssistantScreen, ListeningWarningDialog, LiveScreen, PhotoScreen } from './components/Screens';
import { Modal, Notice, ShowTranslation } from './components/UI';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const route = (): Screen => ['live', 'photo', 'assistant'].includes(location.hash.slice(1)) ? location.hash.slice(1) as Screen : 'home';

export default function App() {
  const [trip, setTrip] = useState<SavedTrip | null>(null);
  const [storageError, setStorageError] = useState(false);
  const latest = useRef(trip);
  latest.current = trip;
  useEffect(() => { void readTrip().then(setTrip).catch(() => { setTrip(emptyTrip()); setStorageError(true); }); }, []);
  useEffect(() => {
    if (!trip) return;
    const timer = setTimeout(() => void writeTrip(trip).catch(() => setStorageError(true)), 200);
    return () => clearTimeout(timer);
  }, [trip]);
  useEffect(() => {
    const flush = () => { if (latest.current) void writeTrip(latest.current).catch(() => {}); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);
  if (!trip) return <main className="app-loading" aria-label="Atveriame vertėją"><LogoMark /><LoaderCircle size={24} className="spin" /><p>Tuoj leisimės į kelionę…</p></main>;
  return <TripApp trip={trip} setTrip={setTrip as Dispatch<SetStateAction<SavedTrip>>} storageError={storageError} />;
}

function TripApp({ trip, setTrip, storageError }: { trip: SavedTrip; setTrip: Dispatch<SetStateAction<SavedTrip>>; storageError: boolean }) {
  const [screen, setScreen] = useState<Screen>(route);
  const online = useNetwork();
  const [help, setHelp] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [liveError, setLiveError] = useState('');
  const [listeningWarning, setListeningWarning] = useState<ListeningWarning | null>(null);
  const [stopReason, setStopReason] = useState<ListeningStopReason | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [showText, setShowText] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [reset, setReset] = useState<'assistant' | 'all' | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const live = useRef<LiveConversation | null>(null);
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const speech = useSpeech();
  const rows = useMemo(() => groupTranscripts(trip.transcripts), [trip.transcripts]);
  const assistant = useChat('assistant', trip.assistant, undefined, (messages) => setTrip((previous) => ({ ...previous, assistant: messages })));
  const photo = useChat('photo', trip.photo?.messages || [], trip.photo?.dataUrl, (messages) => setTrip((previous) => ({ ...previous, photo: previous.photo ? { ...previous.photo, messages } : null })), trip.photo?.name);
  const muted = Boolean(showText) || speech.busy || speech.playing || speech.blocked;
  const active = ['connecting', 'connected', 'reconnecting'].includes(status);

  useEffect(() => {
    const changeRoute = () => setScreen(route());
    const install = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    const appInstalled = () => { setInstalled(true); setInstallEvent(null); setInstallHelp(false); };
    window.addEventListener('hashchange', changeRoute);
    window.addEventListener('beforeinstallprompt', install);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('hashchange', changeRoute); window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);
  useEffect(() => {
    const conversation = new LiveConversation(audio.current!, {
      status: setStatus, error: setLiveError, blocked: setBlocked, level: setLevel,
      warning: setListeningWarning, stopped: setStopReason,
      history: () => tripRef.current.transcripts,
      fragment: (fragment) => setTrip((previous) => previous.transcripts.some((f) => f.id === fragment.id) ? previous : { ...previous, transcripts: [...previous.transcripts, fragment].slice(-800) }),
    });
    live.current = conversation;
    return () => conversation.dispose();
  }, [setTrip]);
  useEffect(() => { live.current?.setMuted(muted); }, [muted]);
  useEffect(() => {
    if (!stopReason) return;
    setShowText(null);
    speech.stop();
  }, [stopReason]);
  useEffect(() => {
    if (screen !== 'live') live.current?.end();
    speech.stop();
    window.scrollTo(0, 0);
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [screen]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try { const result = await navigator.wakeLock.request('screen'); if (cancelled) await result.release(); else lock = result; } catch { /* Optional on devices using battery saver. */ }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => { cancelled = true; void lock?.release(); document.removeEventListener('visibilitychange', acquire); };
  }, [active]);

  function navigate(next: Screen) { if (next === screen) return; location.hash = next === 'home' ? '' : next; setScreen(next); }
  function startLive() { navigate('live'); setElapsed(0); speech.stop(); void live.current?.start(); }
  function endLive() { speech.stop(); live.current?.end(); }
  function draft(mode: 'photo' | 'assistant', value: string) { setTrip((previous) => ({ ...previous, drafts: { ...previous.drafts, [mode]: value } })); }
  async function selectPhoto(file: File) {
    if (selecting) return;
    setSelecting(true); setPhotoError('');
    try {
      const dataUrl = await prepareImage(file);
      photo.cancel();
      setTrip((previous) => ({ ...previous, photo: { dataUrl, name: file.name, messages: [] }, drafts: { ...previous.drafts, photo: '' } }));
      photo.send('Išverskite ir paprastai paaiškinkite šią nuotrauką.', dataUrl, file.name);
    } catch (error) { setPhotoError(error instanceof Error ? error.message : 'Nepavyko atverti nuotraukos.'); }
    finally { setSelecting(false); }
  }
  async function install() {
    if (!installEvent) { setInstallHelp(true); return; }
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }
  function confirmReset() {
    if (reset === 'all') { endLive(); assistant.cancel(); photo.cancel(); setTrip(emptyTrip()); setHelp(false); navigate('home'); }
    else { assistant.cancel(); setTrip((previous) => ({ ...previous, assistant: [], drafts: { ...previous.drafts, assistant: '' } })); }
    setReset(null);
  }

  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); const main = document.getElementById('main-content'); if (main) { main.tabIndex = -1; main.focus(); main.scrollIntoView({ block: 'start' }); } }}>Pereiti prie turinio</a><header className="site-header"><button className="brand" onClick={() => navigate('home')} aria-label="Kelionės vertėjas – pradžia"><LogoMark /><span>Kelionės vertėjas<small>ITALIJA ARČIAU</small></span></button><div className="header-right"><span className={`network-status ${online ? '' : 'is-offline'}`}><span className="mini-dot" />{online ? 'Buon viaggio!' : 'Nėra ryšio'}</span><button className="help-button" aria-label="Kaip naudotis?" onClick={() => setHelp(true)}><CircleHelp size={21} /><span>Kaip naudotis?</span></button></div></header>
    <audio ref={audio} autoPlay playsInline className="live-audio" aria-hidden="true" />
    {!online && <div className="offline-banner" role="status"><WifiOff size={23} /><span>Nėra interneto. Išsaugotą tekstą galite skaityti, o prisijungę – tęsti.</span></div>}
    {storageError && <div className="storage-notice"><Notice>Ši naršyklė negali išsaugoti pokalbio. Neužverkite šio lango, kol norite tęsti.</Notice></div>}
    {screen === 'home' && <Home navigate={navigate} startLive={startLive} />}
    {screen === 'live' && <LiveScreen status={status} error={liveError} stopReason={stopReason} level={level} rows={rows} muted={muted} blocked={blocked} elapsed={elapsed} onBack={() => navigate('home')} start={startLive} end={endLive} play={() => void live.current?.play()} speak={(text) => void speech.speak(text)} show={setShowText} />}
    {screen === 'photo' && <PhotoScreen photo={trip.photo} chat={photo} selecting={selecting} error={photoError} draft={trip.drafts.photo} setDraft={(value) => draft('photo', value)} onBack={() => navigate('home')} onPhoto={(file) => void selectPhoto(file)} speak={(text) => void speech.speak(text)} />}
    {screen === 'assistant' && <AssistantScreen messages={trip.assistant} chat={assistant} draft={trip.drafts.assistant} setDraft={(value) => draft('assistant', value)} onBack={() => navigate('home')} speak={(text) => void speech.speak(text)} clear={() => setReset('assistant')} />}
    <footer className="site-footer"><span><Heart size={16} /> Sukurta ramesnėms kelionėms.</span>{!installed ? <button onClick={() => void install()}><Smartphone size={18} /> Įsidėti į telefoną <span aria-hidden="true">↗</span></button> : <span><Check size={18} /> Jūsų telefone</span>}</footer>
    {(speech.busy || speech.playing || speech.blocked || speech.error) && !showText && <div className="speech-toast" role="status">{speech.error ? <span>{speech.error}</span> : <><Volume2 size={22} /><span>{speech.busy ? 'Ruošiame garsą…' : speech.blocked ? 'Garsas paruoštas' : 'Skaitome balsu…'}</span></>}{speech.blocked && <button className="text-button" onClick={() => void speech.resume()}>Paleisti garsą</button>}<button className="icon-button" aria-label="Uždaryti garso grotuvą" onClick={speech.stop}>{speech.playing ? <Square size={18} fill="currentColor" /> : <X size={21} />}</button></div>}
    {showText && <ShowTranslation text={showText} onClose={() => { speech.stop(); setShowText(null); }} onSpeak={(text) => void speech.speak(text)} audioBusy={speech.busy} audioBlocked={speech.blocked} audioError={speech.error} resume={() => void speech.resume()} />}
    {help && <Modal title="Kaip naudotis?" className="help-modal" onClose={() => setHelp(false)}>
      <div className="help-step"><span className="help-step-icon terracotta"><Mic size={25} aria-hidden="true" /></span><div><h3>Kalbėtis</h3><p>Leiskite naudoti mikrofoną. Kalbėkite lietuviškai – išversime abiem pusėms.</p></div></div>
      <div className="help-step"><span className="help-step-icon sand"><Camera size={25} aria-hidden="true" /></span><div><h3>Išversti nuotrauką</h3><p>Nufotografuokite meniu, ženklą ar bilietą. Galite įkelti ir turimą nuotrauką.</p></div></div>
      <div className="help-step"><span className="help-step-icon sage"><MessageCircle size={25} aria-hidden="true" /></span><div><h3>Paklausti apie Italiją</h3><p>Parašykite arba pasakykite klausimą apie kelionę.</p></div></div>
      <button className="button primary full-width" onClick={() => setHelp(false)}><Check size={22} /> Supratau</button>
      <details className="help-detail"><summary>Ryšys ir privatumas</summary><p>Naujiems vertimams reikia interneto. Pokalbio tekstas ir paskutinė nuotrauka išsaugomi šiame telefone.</p><p>Vertimui garsas, nuotraukos ir klausimai siunčiami „OpenAI“. Garso įrašų mūsų serveris nesaugo. Kai įjungta kelionės istorija, organizatorius gali matyti išsiųstas nuotraukas, klausimus, diktuotą tekstą, atsakymus ir balso pokalbių tekstus. Pranešimai apie veiklą gali būti siunčiami organizatoriui per „ntfy“. Naršyklės žymėjimas leidžia susieti tos pačios naršyklės veiksmus. Balso pokalbis baigiamas išėjus iš jo ekrano.</p><button className="clear-data" onClick={() => setReset('all')}>Ištrinti šiame telefone išsaugotą pokalbį ir nuotrauką</button></details>
    </Modal>}
    {installHelp && <Modal title="Vertėjas – visada po ranka." onClose={() => setInstallHelp(false)}><div className="install-symbol"><Download size={35} /></div><p className="modal-lead">Įsidėkite į telefono pradžios ekraną. Kitą kartą užteks paliesti piktogramą.</p><div className="install-instructions"><h3>„iPhone“ su „Safari“</h3><p>Paspauskite „Bendrinti“ <span aria-hidden="true">↑</span>, tada „Pridėti prie pradžios ekrano“ ir „Pridėti“.</p><h3>„Android“ su „Chrome“</h3><p>Atverkite naršyklės meniu <span aria-hidden="true">⋮</span> ir pasirinkite „Pridėti prie pagrindinio ekrano“ arba „Įdiegti programą“.</p></div><button className="button primary full-width" onClick={() => setInstallHelp(false)}>Supratau</button></Modal>}
    {reset && <Modal title={reset === 'all' ? 'Ištrinti išsaugotą informaciją?' : 'Pradėti naują pokalbį?'} onClose={() => setReset(null)}><p className="modal-lead">{reset === 'all' ? 'Iš šio telefono bus pašalinti pokalbiai, juodraščiai ir nuotrauka.' : 'Ankstesnio pokalbio tekstas bus pašalintas. Galėsite klausti nauja tema.'}</p><div className="dialog-actions"><button className="button secondary" onClick={() => setReset(null)}>Grįžti</button><button className="button primary" onClick={confirmReset}>{reset === 'all' ? 'Ištrinti' : 'Pradėti naują'}</button></div></Modal>}
    {screen === 'live' && listeningWarning && <ListeningWarningDialog warning={listeningWarning} onContinue={() => live.current?.continueListening()} onEnd={endLive} />}
  </div>;
}
