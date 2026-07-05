/** 问答领域分类（从 qa-store.ts 引用） */
export type Domain = 'general' | 'log-analysis' | 'stack-analysis' | 'bug-analysis' | 'build-issue' | 'program-analysis';

export interface QaMessage {
  role: string;
  content: string;
}

export interface QaSession {
  id: string;
  messages: QaMessage[];
  sources: any[];
  repo?: string;
  acpSessionId?: string;
  qid?: number;
  mode?: 'lightweight' | 'deep';
  createdAt: string;
  updatedAt: string;
}

export interface QaSessionSummary {
  id: string;
  summary: string;
  messageCount: number;
  qid?: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionSuggestion {
  question: string;
  sessionId: string;
  updatedAt: string;
}

export interface FrequentQuestion {
  question: string;
  count: number;
  lastAsked: string;
}
