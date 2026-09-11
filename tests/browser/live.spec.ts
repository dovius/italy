import { test, expect } from '@playwright/test';

test('Live handles overlapping captions, fullscreen, reconnect history and immediate microphone cleanup', async ({ page }) => {
  const connections: any[] = [];
  await page.route('**/api/live/session', async (route) => {
    connections.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { session: { id: `live_${connections.length}` }, transport: { sdp: 'v=0\r\nanswer', type: 'webrtc' } } });
  });
  await page.route('**/api/live/end', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    const state = window as any;
    state.captureStreams = [];
    state.sentEvents = [];
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
      const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
      state.captureStreams.push(stream);
      return stream;
    } } });
    class FakeChannel {
      readyState = 'open';
      onmessage: ((event: any) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      emit(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
      send(data: string) { const event = JSON.parse(data); state.sentEvents.push(event); if (event.type === 'session.close') setTimeout(() => this.emit({ type: 'session.closed', reason: 'close_requested' }), 20); }
      close() { this.readyState = 'closed'; this.onclose?.(); }
    }
    class FakePeer extends EventTarget {
      iceGatheringState = 'complete';
      connectionState = 'new';
      localDescription: object | null = null;
      onconnectionstatechange: (() => void) | null = null;
      ontrack = null;
      channel = new FakeChannel();
      constructor() { super(); state.fakePeer = this; }
      addTrack() {}
      createDataChannel() { return this.channel; }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nsynthetic-offer-for-test' }; }
      async setLocalDescription(offer: object) { this.localDescription = offer; }
      async setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); setTimeout(() => this.channel.emit({ type: 'session.started', session: { id: 'fake_session' } }), 20); }
      close() { this.connectionState = 'closed'; }
    }
    window.RTCPeerConnection = FakePeer as any;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Kalbėtis Gyvas/ }).click();
  await expect(page.getByText('Klausomės. Galite kalbėti.', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const peer = (window as any).fakePeer;
    peer.channel.emit({ type: 'session.input_transcript.delta', event_id: 'input_b', delta: ' čia statyti?', start_ms: 400, end_ms: 800 });
    peer.channel.emit({ type: 'session.input_transcript.delta', event_id: 'input_a', delta: 'Ar galime', start_ms: 0, end_ms: 400 });
    peer.channel.emit({ type: 'session.output_transcript.delta', event_id: 'output_a', delta: 'Possiamo parcheggiare qui?', start_ms: 300, end_ms: 1100 });
  });
  await expect(page.getByText('Ar galime čia statyti?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Parodyti žmogui' }).click();
  await expect(page.getByRole('dialog')).toContainText('Possiamo parcheggiare qui?');
  expect(await page.locator('.translation-display p').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(34);
  await page.getByRole('button', { name: 'Grįžti', exact: true }).click();
  await page.evaluate(() => { const peer = (window as any).fakePeer; peer.connectionState = 'failed'; peer.onconnectionstatechange(); });
  await expect.poll(() => connections.length).toBe(2);
  await expect(page.getByText('Klausomės. Galite kalbėti.', { exact: true })).toBeVisible();
  expect(connections[1].history).toEqual([{ role: 'user', text: 'Ar galime čia statyti?' }, { role: 'assistant', text: 'Possiamo parcheggiare qui?' }]);
  expect(await page.evaluate(() => (window as any).captureStreams.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).captureStreams[0].getAudioTracks()[0].readyState)).toBe('live');
  expect(await page.evaluate(() => (window as any).sentEvents.some((event: any) => event.type === 'session.start'))).toBe(false);
  await page.getByRole('button', { name: 'Baigti pokalbį', exact: true }).click();
  await expect(page.getByText('Ačiū už pokalbį.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).captureStreams.every((stream: MediaStream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
  // Starting again while the old close event drains must not close the new peer.
  await page.getByRole('button', { name: 'Tęsti pokalbį', exact: true }).click();
  await expect.poll(() => connections.length).toBe(3);
  await expect(page.getByText('Klausomės. Galite kalbėti.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Į pradžią', exact: true }).click();
  expect(await page.evaluate(() => (window as any).captureStreams.every((stream: MediaStream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
});
