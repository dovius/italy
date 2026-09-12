import type { Page } from '@playwright/test';

// Synthetic capture and WebRTC only: these tests never open the real microphone.
export async function mockLive(page: Page) {
  const connections: any[] = [];
  await page.route('**/api/live/session', async (route) => {
    connections.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { session: { id: `live_${connections.length}` }, transport: { sdp: 'v=0\r\nanswer', type: 'webrtc' } } });
  });
  await page.route('**/api/live/end', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/live/fragments', (route) => route.fulfill({ status: 204 }));
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
  return connections;
}
