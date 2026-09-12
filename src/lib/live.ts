import type { TranscriptFragment } from '../../shared/types';
import { ApiError, mediaError, request } from './api';
import { liveHistory } from './transcripts';
import { CaptionReporter } from './captionReporter';
import { ListeningGuard, type ListeningStopReason, type ListeningWarning } from './listeningGuard';

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';
interface Callbacks {
  status: (status: LiveStatus) => void;
  error: (text: string) => void;
  fragment: (fragment: TranscriptFragment) => void;
  blocked: (blocked: boolean) => void;
  level: (level: number) => void;
  history: () => TranscriptFragment[];
  warning: (warning: ListeningWarning | null) => void;
  stopped: (reason: ListeningStopReason | null) => void;
}

export class LiveConversation {
  private safety: ListeningGuard;
  private captions = new CaptionReporter();
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private abort: AbortController | null = null;
  private audioContext: AudioContext | null = null;
  private analyserTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private id: string | null = null;
  private run = 0;
  private wanted = false;
  private tries = 0;
  private muted = false;
  private ready = false;

  constructor(private audio: HTMLAudioElement, private callbacks: Callbacks) {
    this.safety = new ListeningGuard(callbacks.warning, (reason) => this.stopForSafety(reason));
    window.addEventListener('online', this.online);
    window.addEventListener('trip:online', this.online);
    window.addEventListener('offline', this.offline);
    window.addEventListener('pagehide', this.pagehide);
    document.addEventListener('visibilitychange', this.visibility);
  }
  private online = () => { if (this.wanted && !this.peer) { clearTimeout(this.retryTimer); this.tries = 0; void this.connect(true); } };
  private offline = () => { if (this.wanted) this.reconnect(); };
  private pagehide = () => { if (this.wanted) this.stopForSafety('hidden'); else this.end(true); };
  private visibility = () => { if (document.visibilityState === 'hidden' && this.wanted) this.stopForSafety('hidden'); };

  private stopForSafety(reason: ListeningStopReason) {
    if (!this.wanted) return;
    this.callbacks.stopped(reason);
    this.callbacks.error('');
    // Release capture and close the peer synchronously, before mobile browsers
    // can suspend this page. Never restart automatically when it becomes visible.
    this.end(true);
  }

  continueListening() { this.safety.confirm(); }

  async start() {
    if (this.wanted || document.visibilityState === 'hidden') return;
    this.cleanup();
    this.wanted = true;
    this.tries = 0;
    this.callbacks.error('');
    this.callbacks.stopped(null);
    // Audio playback is also retried from an explicit accessible button if iOS blocks it.
    this.audio.autoplay = true;
    await this.connect(false);
  }
  private async connect(retry: boolean) {
    if (!this.wanted) return;
    if (!navigator.onLine) {
      this.callbacks.status('reconnecting');
      this.callbacks.error('Nėra interneto. Prisijungus pokalbis bus tęsiamas automatiškai.');
      return;
    }
    const run = ++this.run;
    this.callbacks.status(retry ? 'reconnecting' : 'connecting');
    this.callbacks.error('');
    const controller = new AbortController();
    this.abort = controller;
    let peer: RTCPeerConnection | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Ši naršyklė nepalaiko balso pokalbio. Atverkite vertėją „Safari“ arba „Chrome“.');
      const existing = this.microphone?.getAudioTracks().some((track) => track.readyState === 'live') ? this.microphone : null;
      const microphone = existing || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (run !== this.run || !this.wanted) { microphone.getTracks().forEach((t) => t.stop()); return; }
      this.microphone = microphone;
      this.safety.start();
      microphone.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
      if (!this.audioContext) this.meter(microphone);
      peer = new RTCPeerConnection();
      this.peer = peer;
      const connection = peer;
      microphone.getTracks().forEach((track) => connection.addTrack(track, microphone));
      connection.ontrack = (event) => {
        if (run !== this.run) return;
        this.audio.srcObject = new MediaStream([event.track]);
        void this.play();
      };
      connection.onconnectionstatechange = () => {
        if (run !== this.run || !this.wanted) return;
        if (connection.connectionState === 'failed') this.reconnect();
        else if (connection.connectionState === 'disconnected') {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => { if (run === this.run && connection.connectionState !== 'connected') this.reconnect(); }, 3500);
        } else if (connection.connectionState === 'connected') clearTimeout(this.disconnectTimer);
      };
      const channel = connection.createDataChannel('oai-events');
      this.channel = channel;
      channel.onmessage = ({ data }) => {
        if (run !== this.run) return;
        let event: Record<string, unknown>;
        try { event = JSON.parse(data); } catch { return; }
        if (event.type === 'session.started') {
          this.ready = true;
          this.tries = 0;
          clearTimeout(this.startupTimer);
          this.callbacks.status('connected');
          this.callbacks.error('');
        } else if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
          if (typeof event.delta !== 'string' || typeof event.start_ms !== 'number' || typeof event.end_ms !== 'number') return;
          // Speech captions, rather than microphone volume, count as activity.
          if (event.delta.trim()) this.safety.heardSpeech();
          const fragment: TranscriptFragment = { id: typeof event.event_id === 'string' ? event.event_id : crypto.randomUUID(), session: this.id || `connection-${run}`, role: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant', text: event.delta, start: event.start_ms, end: event.end_ms };
          this.callbacks.fragment(fragment);
          if (this.id) this.captions.add(fragment);
        } else if (event.type === 'session.closed') {
          const reconnect = this.wanted && ['connection_error', 'connection_lost', 'transport_error'].includes(String(event.reason));
          if (reconnect) this.reconnect();
          else { this.wanted = false; this.cleanup(); this.callbacks.status('ended'); }
        } else if (event.type === 'error') {
          this.callbacks.error('Vertimas trumpam sutriko. Pakartokite paskutinę frazę.');
        }
      };
      channel.onclose = () => { if (run === this.run && this.wanted) this.reconnect(); };
      channel.onerror = () => { if (run === this.run && this.wanted) this.reconnect(); };
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await this.gather(connection, controller.signal);
      if (run !== this.run || !this.wanted) return;
      const response = await request('/api/live/session', { sdp: connection.localDescription?.sdp, history: liveHistory(this.callbacks.history()) }, controller.signal, 30_000);
      const data = await response.json() as { session: { id: string }; transport: { sdp: string } };
      if (run !== this.run || !this.wanted) { this.hangup(data.session.id); return; }
      this.id = data.session.id;
      await connection.setRemoteDescription({ type: 'answer', sdp: data.transport.sdp });
      if (!this.ready) this.startupTimer = setTimeout(() => { if (run === this.run && this.wanted && !this.ready) this.reconnect(); }, 18_000);
    } catch (error) {
      if (run !== this.run || !this.wanted) { peer?.close(); return; }
      const network = error instanceof ApiError && (!error.status || error.status >= 500) && !['not_configured', 'service_unavailable'].includes(error.code);
      if (network && this.tries < 4) this.reconnect();
      else {
        this.wanted = false;
        this.cleanup();
        this.callbacks.status('error');
        this.callbacks.error(mediaError(error));
      }
    }
  }
  private gather(peer: RTCPeerConnection, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', changed);
        signal.removeEventListener('abort', cancelled);
        error ? reject(error) : resolve();
      };
      const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
      const cancelled = () => finish(new DOMException('Cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(new ApiError('Nepavyko prisijungti prie garso. Patikrinkite internetą ir pabandykite dar kartą.')), 10_000);
      peer.addEventListener('icegatheringstatechange', changed);
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled(); else changed();
    });
  }
  private meter(stream: MediaStream) {
    try {
      this.audioContext = new AudioContext();
      void this.audioContext.resume().catch(() => {});
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      this.analyserTimer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const energy = Math.sqrt(samples.reduce((n, x) => n + ((x - 128) / 128) ** 2, 0) / samples.length);
        this.callbacks.level(this.muted ? 0 : Math.min(1, energy * 7));
      }, 80);
    } catch { /* Capturing and playback do not depend on the optional visual meter. */ }
  }
  private reconnect() {
    if (!this.wanted) return;
    // Keep already-authorized capture alive across a brief outage. iOS may require
    // another user gesture if every capture track is stopped before reconnecting.
    this.cleanup(true, true);
    if (++this.tries > 4) {
      this.wanted = false;
      this.cleanup();
      this.callbacks.status('error');
      this.callbacks.error('Ryšys silpnas. Išsaugotas tekstas išliko. Pabandykite pradėti pokalbį dar kartą.');
      return;
    }
    this.callbacks.status('reconnecting');
    this.callbacks.error(navigator.onLine ? 'Ryšys nutrūko. Atkuriame pokalbį…' : 'Nėra interneto. Prisijungus pokalbis bus tęsiamas automatiškai.');
    if (navigator.onLine) this.retryTimer = setTimeout(() => void this.connect(true), Math.min(1000 * 2 ** this.tries, 12_000));
  }
  async play() {
    try { await this.audio.play(); this.callbacks.blocked(false); }
    catch { this.callbacks.blocked(true); }
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    this.audio.muted = muted;
    this.microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  }
  private hangup(id: string, beacon = false) {
    const data = JSON.stringify({ sessionId: id });
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon('/api/live/end', new Blob([data], { type: 'application/json' }))) return; } catch { /* Try a keepalive request if the beacon cannot be queued. */ }
    }
    void fetch('/api/live/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(() => {});
  }
  end(beacon = false) {
    this.safety.stop();
    void this.captions.flush(beacon);
    this.wanted = false;
    clearTimeout(this.retryTimer);
    this.callbacks.status('ended');
    // Stop capturing immediately, but let session.closed drain over the event channel.
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.audio.pause();
    if (beacon) { if (this.id) this.hangup(this.id, true); this.cleanup(false); return; }
    if (this.ready && this.channel?.readyState === 'open') {
      try {
        this.channel.send(JSON.stringify({ type: 'session.close' }));
        this.closeTimer = setTimeout(() => this.cleanup(), 4000);
      } catch { this.cleanup(); }
    } else this.cleanup();
  }
  private cleanup(hangup = true, keepCapture = false) {
    void this.captions.flush();
    this.run++;
    this.ready = false;
    this.abort?.abort();
    clearTimeout(this.retryTimer);
    clearTimeout(this.disconnectTimer);
    clearTimeout(this.startupTimer);
    clearTimeout(this.closeTimer);
    if (!keepCapture) {
      this.safety.stop();
      clearInterval(this.analyserTimer);
      this.microphone?.getTracks().forEach((track) => track.stop());
      this.microphone = null;
      void this.audioContext?.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.channel) { this.channel.onclose = null; this.channel.onmessage = null; this.channel.onerror = null; this.channel.close(); }
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.ontrack = null; this.peer.close(); }
    this.peer = null;
    this.channel = null;
    this.audio.srcObject = null;
    if (this.id && hangup) this.hangup(this.id);
    this.id = null;
    this.callbacks.level(0);
    this.callbacks.blocked(false);
  }
  dispose() {
    this.wanted = false;
    this.cleanup();
    this.captions.dispose();
    window.removeEventListener('online', this.online);
    window.removeEventListener('trip:online', this.online);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('pagehide', this.pagehide);
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
