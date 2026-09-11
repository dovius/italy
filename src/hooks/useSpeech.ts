import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';

export function useSpeech() {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, string>());
  const run = useRef(0);
  function stop() {
    run.current++;
    abort.current?.abort();
    audio.current?.pause();
    window.speechSynthesis?.cancel();
    setBusy(false); setPlaying(false); setBlocked(false);
    setError('');
  }
  async function resume() {
    try { await audio.current?.play(); setBlocked(false); setBusy(false); setPlaying(true); }
    catch { setBlocked(true); setError('Paspauskite „Paleisti garsą“ arba patikrinkite telefono garsumą.'); }
  }
  async function speak(text: string) {
    stop();
    const id = run.current;
    setError('');
    if (!navigator.onLine && !cache.current.has(text.slice(0, 4096)) && 'speechSynthesis' in window) {
      const locale = /[ąčęėįšųūž]/i.test(text) ? 'lt' : 'it';
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(locale));
      if (!voice) { setError('Šiam garsui reikia interneto. Vertimą galite parodyti ekrane.'); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.rate = 0.85;
      utterance.onend = () => { if (id === run.current) setPlaying(false); };
      utterance.onerror = () => { if (id === run.current) { setPlaying(false); setError('Garso nepavyko paleisti. Vertimą galite parodyti ekrane.'); } };
      setPlaying(true);
      window.speechSynthesis.speak(utterance);
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const input = text.slice(0, 4096);
      let url = cache.current.get(input);
      if (!url) {
        const response = await request('/api/speech', { text: input }, controller.signal);
        url = URL.createObjectURL(await response.blob());
        if (id !== run.current) { URL.revokeObjectURL(url); return; }
        if (cache.current.size >= 10) { const oldest = cache.current.keys().next().value!; URL.revokeObjectURL(cache.current.get(oldest)!); cache.current.delete(oldest); }
        cache.current.set(input, url);
      }
      if (id !== run.current) return;
      const player = new Audio(url);
      audio.current = player;
      player.onended = () => { if (id === run.current) { setPlaying(false); setBusy(false); } };
      player.onerror = () => { if (id === run.current) { setPlaying(false); setBusy(false); setError('Garso nepavyko paleisti. Pabandykite dar kartą.'); } };
      await resume();
    } catch (cause) {
      if (id === run.current) { setBusy(false); setError(cause instanceof Error ? cause.message : 'Nepavyko paleisti garso.'); }
    }
  }
  useEffect(() => () => {
    run.current++;
    abort.current?.abort();
    audio.current?.pause();
    window.speechSynthesis?.cancel();
    cache.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  return { speak, stop, resume, busy, playing, blocked, error };
}
