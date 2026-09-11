export type Screen = 'home' | 'live' | 'photo' | 'assistant';
export type ChatMode = 'photo' | 'assistant';
export interface Citation { title: string; url: string }
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: Citation[];
}
export interface ChatResult { text: string; sources: Citation[] }
export interface PhotoContext { dataUrl: string; name: string; messages: Message[] }
export interface TranscriptFragment {
  id: string;
  session: string;
  role: 'user' | 'assistant';
  text: string;
  start: number;
  end: number;
}
export interface TranscriptRow {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  session: string;
  start: number;
  end: number;
}
export interface SavedTrip {
  version: 1;
  photo: PhotoContext | null;
  assistant: Message[];
  transcripts: TranscriptFragment[];
  drafts: { photo: string; assistant: string };
}
