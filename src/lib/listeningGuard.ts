export type ListeningStopReason = 'silence' | 'duration' | 'hidden';
export type ListeningWarning = { reason: 'silence' | 'duration'; seconds: number };

const SILENCE_LIMIT = 2 * 60_000;
const CONFIRM_INTERVAL = 10 * 60_000;
const WARNING_TIME = 20_000;

/** A conversation's deadlines survive reconnects. Only a deliberate tap renews
 * the ten-minute limit: restaurant chatter cannot keep a forgotten mic on. */
export class ListeningGuard {
  private timer?: ReturnType<typeof setInterval>;
  private lastSpeech = 0;
  private confirmed = 0;
  private warning: ListeningWarning | null = null;

  constructor(
    private onWarning: (warning: ListeningWarning | null) => void,
    private onStop: (reason: ListeningStopReason) => void,
  ) {}

  start() {
    if (this.timer !== undefined) return;
    this.lastSpeech = this.confirmed = Date.now();
    this.timer = setInterval(() => this.check(), 1000);
  }

  heardSpeech() {
    // Check the old deadline first, including after delayed browser timers.
    if (!this.check()) return;
    this.lastSpeech = Date.now();
    this.check();
  }

  confirm() {
    if (!this.check()) return;
    this.lastSpeech = this.confirmed = Date.now();
    this.check();
  }

  private check() {
    if (this.timer === undefined) return false;
    const silenceEnd = this.lastSpeech + SILENCE_LIMIT;
    const durationEnd = this.confirmed + CONFIRM_INTERVAL;
    const reason = durationEnd <= silenceEnd ? 'duration' : 'silence';
    const remaining = Math.min(silenceEnd, durationEnd) - Date.now();
    if (remaining <= 0) {
      this.stop();
      this.onStop(reason);
      return false;
    }
    this.publish(remaining <= WARNING_TIME ? { reason, seconds: Math.ceil(remaining / 1000) } : null);
    return true;
  }

  private publish(warning: ListeningWarning | null) {
    if (this.warning?.reason === warning?.reason && this.warning?.seconds === warning?.seconds) return;
    this.warning = warning;
    this.onWarning(warning);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.publish(null);
  }
}
