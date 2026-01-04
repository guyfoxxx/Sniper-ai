export type Role = 'system' | 'user' | 'assistant';

export type MemoryMessage = {
  role: Role;
  content: string;
  ts: number;
};

export type NewsItem = {
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
  snippet?: string;
  score?: number; // 1..10 (Gemma)
};

export type SignalResult = {
  market: string;
  timeframe?: string;
  thesis: string;
  levels: {
    entry?: string;
    stop?: string;
    targets?: string[];
    invalidation?: string;
  };
  risk: {
    style?: string;
    confidence?: string;
    notes?: string;
  };
  news?: NewsItem[];
};
