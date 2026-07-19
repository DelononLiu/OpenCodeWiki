export interface Repo {
  name: string
  path: string
}

export interface QaEntry {
  qid: number
  session_id: string
  question: string
  answer: string | null
  repo: string
  domain: string
  status: 'active' | 'pending' | 'archived'
  is_calibrated: boolean
  calibrated_answer?: { answer: string; calibrator: string } | null
  tags: string[]
  created_at: string
  updated_at: string
  visit_count: number
}

export interface Topic {
  slug: string
  name: string
  description: string
  status: 'pool' | 'published'
  wiki_module: string | null
  qa_count?: number
  created_at: string
  published_at: string | null
}

export interface TopicDraft {
  topic_slug: string
  raw_content: string
  edited_content: string | null
  status: 'pending' | 'approved' | 'rejected'
}

export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface WikiPageResponse {
  type: 'wiki' | 'topic'
  slug: string
  content: string
  topic?: { name: string; description: string; status: string; wiki_module: string | null }
  qa_entries?: { qid: number; question: string; created_at: string }[]
  wiki_links?: { slug: string; name: string }[]
}
