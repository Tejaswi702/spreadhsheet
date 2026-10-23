import { describe, it, expect, vi } from 'vitest'
import { createProvider, createHttpProvider } from './provider.js'
import { createMockProvider } from './mockProvider.js'

describe('Challenge 4 - Task 4.3: LLM Provider Abstraction', () => {
  describe('Mock Provider (Deterministic Offline)', () => {
    it('creates a mock provider that answers golden prompts', async () => {
      const provider = createMockProvider()
      expect(provider.name).toBe('mock')

      const response = await provider.complete({
        user: 'What is the total sales by region?',
      })

      expect(response.provider).toBe('mock')
      expect(response.text).toContain('query')
      expect(response.text).toContain('Total Sales')
    })

    it('returns a clarify question for unknown prompts', async () => {
      const provider = createMockProvider()
      const response = await provider.complete({
        user: 'Can you write me a poem about spreadsheets?',
      })

      expect(response.provider).toBe('mock')
      expect(response.text).toContain('clarify')
    })
  })

  describe('HTTP Provider (createHttpProvider)', () => {
    it('throws when endpoint is missing', async () => {
      const provider = createHttpProvider({ endpoint: '' })
      await expect(provider.complete({ user: 'hello' })).rejects.toThrow(
        /HTTP provider endpoint is missing/,
      )
    })

    it('makes a POST fetch request and extracts model text', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"type":"query","filters":[]}',
              },
            },
          ],
        }),
      })

      globalThis.fetch = mockFetch

      const provider = createHttpProvider({
        endpoint: 'https://api.example.com/v1/chat/completions',
        apiKey: 'test-key-123',
        model: 'gpt-4o',
      })

      const res = await provider.complete({
        system: 'You are an AI assistant',
        user: 'Show me sales',
        history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
      })

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.example.com/v1/chat/completions')
      expect(options.method).toBe('POST')
      expect(options.headers['Authorization']).toBe('Bearer test-key-123')

      const body = JSON.parse(options.body)
      expect(body.model).toBe('gpt-4o')
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are an AI assistant' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'Show me sales' },
      ])

      expect(res.provider).toBe('http')
      expect(res.text).toBe('{"type":"query","filters":[]}')
    })

    it('surfaces authentication failures with clear messages', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Incorrect API key provided' } }),
      })

      const provider = createHttpProvider({ endpoint: 'https://api.example.com' })
      await expect(provider.complete({ user: 'test' })).rejects.toThrow(
        /Authentication error \(401\)/,
      )
    })

    it('surfaces rate limit failures (429) clearly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Quota exceeded' } }),
      })

      const provider = createHttpProvider({ endpoint: 'https://api.example.com' })
      await expect(provider.complete({ user: 'test' })).rejects.toThrow(
        /Rate limit exceeded \(429\)/,
      )
    })

    it('surfaces network errors cleanly', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

      const provider = createHttpProvider({ endpoint: 'https://api.example.com' })
      await expect(provider.complete({ user: 'test' })).rejects.toThrow(
        /Network failure: Failed to fetch/,
      )
    })
  })

  describe('Provider Factory (createProvider)', () => {
    it('returns mock provider by default', () => {
      const provider = createProvider('mock')
      expect(provider.name).toBe('mock')
    })

    it('returns http provider when specified', () => {
      const provider = createProvider('http')
      expect(provider.name).toBe('http')
    })
  })
})
