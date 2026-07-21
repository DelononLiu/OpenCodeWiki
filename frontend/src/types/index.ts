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

export interface TopicSuggestion {
  slug: string
  name: string
  description: string
  qa_ids: number[]
  is_new: boolean
}

export interface AnalyzeResult {
  suggestions: TopicSuggestion[]
  matched: TopicSuggestion[]
  total_new: number
  error?: string
}

export interface ReviewItem {
  topic_slug: string
  topic_name: string
  topic_description: string
  raw_content: string
  edited_content: string | null
  status: string
  created_at: string
  updated_at: string
  generated_at: string | null
}

export interface PipelineCounts {
  qaPending: number
  unclassified: number
  topicDraft: number
  reviewQueue: number
}
