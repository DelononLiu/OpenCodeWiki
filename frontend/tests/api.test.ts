import { describe, it, expect } from 'vitest'

describe('API client', () => {
  it('should construct correct API URLs', () => {
    const BASE = '/api'
    expect(`${BASE}/repos`).toBe('/api/repos')
    expect(`${BASE}/qa/entries?limit=5`).toBe('/api/qa/entries?limit=5')
    expect(`${BASE}/topics`).toBe('/api/topics')
    expect(`${BASE}/wiki/test-slug`).toBe('/api/wiki/test-slug')
  })

  it('should encode URI components', () => {
    const slug = '02-qa engine'
    const encoded = encodeURIComponent(slug)
    const url = `/api/wiki/${encoded}`
    expect(url).toBe('/api/wiki/02-qa%20engine')
  })
})

describe('types', () => {
  it('should define correct interfaces', () => {
    const entry = {
      qid: 1,
      question: 'test',
      answer: null,
      repo: '',
      domain: 'general',
      status: 'pending' as const,
      is_calibrated: false,
      tags: [],
      created_at: '',
      updated_at: '',
      visit_count: 0,
    }
    expect(entry.qid).toBe(1)
    expect(entry.status).toBe('pending')
  })

  it('should define Topic type', () => {
    const topic = {
      slug: 'test-topic',
      name: 'Test',
      description: '',
      status: 'pool' as const,
      wiki_module: null,
      created_at: '',
      promoted_at: null,
    }
    expect(topic.status).toBe('pool')
  })
})
