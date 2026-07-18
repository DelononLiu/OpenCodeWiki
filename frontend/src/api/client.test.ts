import { describe, it, expect } from 'vitest'
import { fetchRepos, fetchQaEntries, fetchQaSuggest, fetchWikiPage, fetchTopics, fetchSettings } from './client'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

describe('API client', () => {
  it('should fetch repos', async () => {
    const repos = await fetchRepos()
    expect(Array.isArray(repos)).toBe(true)
  })

  it('should fetch QA entries', async () => {
    const result = await fetchQaEntries({ status: 'pending', limit: 5 })
    expect(result.entries).toBeDefined()
    expect(result.total).toBeGreaterThanOrEqual(0)
  })

  it('should fetch QA suggest', async () => {
    const result = await fetchQaSuggest('数据库')
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1)
  })

  it('should return empty suggestion for short query', async () => {
    const result = await fetchQaSuggest('a')
    expect(result.suggestions).toEqual([])
  })

  it('should fetch wiki page', async () => {
    const page = await fetchWikiPage('test-page')
    expect(page.content).toContain('页面内容')
  })

  it('should fetch topics', async () => {
    const topics = await fetchTopics()
    expect(Array.isArray(topics)).toBe(true)
    if (topics.length > 0) {
      expect(topics[0].slug).toBeDefined()
    }
  })

  it('should fetch settings', async () => {
    const settings = await fetchSettings()
    expect(settings.general.site_name).toBe('TestWiki')
  })

  it('should throw on non-ok response', async () => {
    server.use(
      http.get('/api/wiki/nonexistent-page', () =>
        HttpResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
      )
    )
    await expect(fetchWikiPage('nonexistent-page')).rejects.toThrow('Not found')
  })
})
