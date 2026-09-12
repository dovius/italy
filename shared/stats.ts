import type { Citation, TranscriptFragment } from './types';

export const activityKinds = ['question', 'photo', 'live', 'dictation', 'speech'] as const;
export type ActivityKind = typeof activityKinds[number];
export const activityLabels: Record<ActivityKind, string> = {
  question: 'Klausimas', photo: 'Nuotrauka', live: 'Balso pokalbis', dictation: 'Diktavimas', speech: 'Skaitymas balsu',
};
export const visitorLabel = (id: string, name?: string) => name || `Keliautojas ${id.slice(0, 6).toUpperCase()}`;

export interface Activity {
  id: string;
  visitorId: string;
  visitorName: string;
  kind: ActivityKind;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  status: 'pending' | 'complete' | 'error' | 'active' | 'ended';
  text: string;
  answer: string;
  error: string;
  imageId: string | null;
  imageName: string;
  sources: Citation[];
  notification: 'off' | 'pending' | 'sent' | 'failed';
  fragments?: TranscriptFragment[];
}
export interface StatsVisitor { id: string; name: string; count: number; lastSeen: number }
export interface StatsPage {
  events: Activity[];
  total: number;
  page: number;
  pages: number;
  counts: Record<ActivityKind, number>;
  visitors: StatsVisitor[];
  retentionDays: number;
  ntfyConfigured: boolean;
  notificationFailures: number;
}

// Sent only between trusted server adapters and the activity store.
export type StatsCommand =
  | { action: 'chat'; visitor: string; requestId: string; conversationId: string; mode: 'assistant' | 'photo'; text: string; image?: string; imageName?: string }
  | { action: 'answer'; visitor: string; requestId: string; text: string; sources: Citation[] }
  | { action: 'failure'; visitor: string; requestId: string; error: string }
  | { action: 'live'; visitor: string; sessionId: string }
  | { action: 'fragments'; visitor: string; sessionId: string; fragments: TranscriptFragment[] }
  | { action: 'end'; visitor: string; sessionId: string }
  | { action: 'dictation' | 'speech'; visitor: string; text: string };

export interface StatsConfig {
  STATS_ADMIN_PASSWORD?: string;
  STATS_RETENTION_DAYS?: string;
  NTFY_TOPIC_URL?: string;
  NTFY_TOKEN?: string;
  APP_ORIGIN?: string;
}
