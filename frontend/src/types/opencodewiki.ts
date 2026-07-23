export interface KB {
  id: string
  name: string
  description: string
  embedding_model: string
  chunk_config: string
  created_at: string
  doc_count?: number
  chunk_count?: number
  is_default?: boolean
}

export interface Document {
  id: string
  kb_id: string
  title: string
  file_path: string
  file_hash: string
  file_type: string
  status: 'processing' | 'completed' | 'failed'
  chunks_count: number
  error_message?: string
  created_at: string
}

export interface Session {
  id: string
  kb_id: string
  title: string
  created_at: string
  messages?: Message[]
}

export interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  sources: string
  token_count: number
  thinking?: string
  created_at: string
}

export interface QASource {
  doc_title: string
  chunk_id: string
  content: string
  score: number
}

export interface StageInfo {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  duration_ms?: number
  detail?: string
}

export interface ProcessSummary {
  queries: number
  docs: number
  chunks: number
}

export interface SSEEvent {
  type: 'token' | 'sources' | 'done' | 'error'
  data: TokenData | QASource[] | DoneData | ErrorData
}

export interface TokenData {
  text: string
  event_id: number
}

export interface DoneData {
  session_id: string
  tokens: number
}

export interface ErrorData {
  message: string
}

export interface Config {
  llm: { provider: string; model: string; base_url: string }
  embedding: { provider: string; model: string }
}
