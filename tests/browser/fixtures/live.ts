import type { Page } from '@playwright/test';

// Synthetic capture and WebRTC only: these tests never open the real microphone.
export async function mockLive(page: Page, options: { autoStart?: boolean; meter?: boolean } = {}) {
  const connections: any[] = [];
  await page.route('**/api/live/session', async (route) => {
    connections.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { session: { id: `live_${connections.length}` }, transport: { sdp: 'v=0\r\nanswer', type: 'webrtc' } } });
  });
  await page.route('**/api/live/end', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/live/fragments', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript((options) => {
    const state = window as any;
    state.captureStreams = [];
    state.sentEvents = [];
    state.microphoneLevel = 0;
    if (options.meter) {
      // Exercise the real LiveConversation meter without opening any hardware.
      class FakeAudioContext {
        async resume() {}
        async close() {}
        createMediaStreamSource() { return { connect() {} }; }
        createAnalyser() {
          return { fftSize: 256, getByteTimeDomainData(samples: Uint8Array) {
            for (let i = 0; i < samples.length; i++) samples[i] = 128 + Math.sin(i / 6) * state.microphoneLevel * 128;
          } };
        }
      }
      window.AudioContext = FakeAudioContext as any;
    }
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
      async setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); if (options.autoStart !== false) setTimeout(() => this.channel.emit({ type: 'session.started', session: { id: 'fake_session' } }), 20); }
      close() { this.connectionState = 'closed'; }
    }
    window.RTCPeerConnection = FakePeer as any;
  }, options);
  return connections;
}
