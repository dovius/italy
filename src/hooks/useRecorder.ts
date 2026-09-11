import { useEffect, useRef, useState } from 'react';
import { mediaError, request } from '../lib/api';

export function useRecorder(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef(onText);
  latest.current = onText;

  function stop() { if (recorder.current?.state === 'recording') recorder.current.stop(); }
  async function start() {
    const run = ++generation.current;
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Ši naršyklė negali įrašyti balso. Atverkite vertėją „Safari“ arba „Chrome“, arba parašykite klausimą.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (run !== generation.current) { media.getTracks().forEach((t) => t.stop()); return; }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recording.onerror = () => {
        setError('Įrašymas nutrūko. Pabandykite dar kartą arba parašykite klausimą.');
        stop();
      };
      recording.onstop = async () => {
        clearInterval(timer.current);
        media.getTracks().forEach((t) => t.stop());
        if (run !== generation.current) return;
        setRecording(false);
        const blob = new Blob(chunks, { type: recording.mimeType || 'audio/webm' });
        if (blob.size < 100) { setError('Įrašas per trumpas. Pabandykite dar kartą.'); return; }
        setTranscribing(true);
        const controller = new AbortController();
        abort.current = controller;
        try {
          const body = new FormData();
          body.append('audio', blob, recording.mimeType.includes('mp4') ? 'klausimas.m4a' : 'klausimas.webm');
          const response = await request('/api/transcribe', body, controller.signal);
          const result = await response.json() as { text: string };
          if (run === generation.current) latest.current(result.text);
        } catch (cause) {
          if (run === generation.current) setError(cause instanceof Error ? cause.message : 'Nepavyko atpažinti balso. Pabandykite dar kartą.');
        } finally { if (run === generation.current) setTranscribing(false); }
      };
      recording.start(1000);
      setRecording(true);
      setSeconds(0);
      let elapsed = 0;
      timer.current = setInterval(() => { setSeconds(++elapsed); if (elapsed >= 60) stop(); }, 1000);
    } catch (cause) { if (run === generation.current) { stream.current?.getTracks().forEach((track) => track.stop()); setRecording(false); setError(mediaError(cause)); } }
  }
  useEffect(() => () => {
    generation.current++;
    clearInterval(timer.current);
    abort.current?.abort();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);
  return { recording, transcribing, seconds, error, start, stop };
}
