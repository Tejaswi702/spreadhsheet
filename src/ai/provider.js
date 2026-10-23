// ─────────────────────────────────────────────────────────────
//  LLM provider abstraction.
//
//  The app never talks to a model directly — it talks to a
//  `provider`. A provider is any object with:
//
//      complete({ system, user, history }) => Promise<{ text, provider }>
//
//  `text` is the raw model output. You are expected to extract and
//  validate JSON from it yourself: models wrap JSON in prose, in code
//  fences, or return something that is not JSON at all.
//
//  Two providers ship with the repo:
//    • mock  — deterministic, offline, answers the prompts listed in
//              fixtures/ai-eval/*.json. Used by graders. The default.
//    • http  — YOURS. Call any LLM API you like (Anthropic, OpenAI,
//              Gemini, Ollama, …) with plain fetch(). Read the endpoint,
//              key and model from the VITE_AI_* env vars (.env.example).
//
//  Do not hard-code a vendor anywhere else: everything outside this
//  file must behave identically with either provider.
// ─────────────────────────────────────────────────────────────
import { createMockProvider } from './mockProvider.js'

/**
 * @typedef {{ role: 'user' | 'assistant', content: string }} ChatTurn
 * @typedef {{ system: string, user: string, history?: ChatTurn[] }} CompletionRequest
 * @typedef {{ text: string, provider: string }} CompletionResponse
 * @typedef {{ name: string, complete: (req: CompletionRequest) => Promise<CompletionResponse> }} Provider
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

/** @returns {Provider} */
export function createHttpProvider(config = {}) {
    const endpoint = config.endpoint ?? env.VITE_AI_ENDPOINT
    const apiKey = config.apiKey ?? env.VITE_AI_API_KEY
    const model = config.model ?? env.VITE_AI_MODEL

    return {
        name: 'http',
        async complete(request) {
            if (!endpoint) {
                throw new Error('HTTP provider endpoint is missing. Please set VITE_AI_ENDPOINT in .env.local')
            }

            // Build conversation turns
            const messages = []
            if (request.system) {
                messages.push({ role: 'system', content: request.system })
            }
            if (Array.isArray(request.history)) {
                for (const turn of request.history) {
                    if (turn && turn.role && turn.content) {
                        messages.push({ role: turn.role, content: turn.content })
                    }
                }
            }
            if (request.user) {
                messages.push({ role: 'user', content: request.user })
            }

            const headers = {
                'Content-Type': 'application/json',
            }
            if (apiKey) {
                headers['Authorization'] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`
            }

            let response
            try {
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model: model || 'default',
                        messages,
                    }),
                })
            } catch (networkErr) {
                throw new Error(`Network failure: ${networkErr.message || 'Unable to reach AI endpoint'}`)
            }

            if (!response.ok) {
                let errorDetails = ''
                try {
                    const errorJson = await response.json()
                    errorDetails = errorJson.error?.message || errorJson.message || JSON.stringify(errorJson)
                } catch {
                    errorDetails = response.statusText || 'Unknown error'
                }

                if (response.status === 401 || response.status === 403) {
                    throw new Error(`Authentication error (${response.status}): ${errorDetails || 'Invalid API key or unauthorized'}`)
                }
                if (response.status === 429) {
                    throw new Error(`Rate limit exceeded (${response.status}): ${errorDetails || 'Too many requests, please retry later'}`)
                }
                throw new Error(`Provider error (${response.status}): ${errorDetails}`)
            }

            const data = await response.json()
            // Extract response text across common standard payload shapes (OpenAI, Anthropic, Ollama, etc.)
            let text = ''
            if (data.choices && data.choices[0]?.message?.content) {
                text = data.choices[0].message.content
            } else if (data.content && Array.isArray(data.content) && data.content[0]?.text) {
                text = data.content[0].text
            } else if (data.message?.content) {
                text = data.message.content
            } else if (data.response) {
                text = data.response
            } else if (typeof data === 'string') {
                text = data
            } else {
                text = JSON.stringify(data)
            }

            return {
                text,
                provider: 'http',
            }
        },
    }
}

/**
 * Pick a provider from VITE_AI_PROVIDER. Unknown values fall back to mock
 * so the app always boots.
 * @returns {Provider}
 */
export function createProvider(kind = env.VITE_AI_PROVIDER || 'mock') {
    if (kind === 'http') return createHttpProvider()
    return createMockProvider()
}
