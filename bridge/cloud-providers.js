// Cloud AI Providers - OpenAI-compatible interface
// Supports: Google Gemini (Generative Language API)

import https from 'https';
import { URL } from 'url';

class CloudAIClient {
  constructor() {
    this.providers = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // Google Gemini
    this.providers.set('google', {
      name: 'Google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      transformRequest: (model, payload) => ({
        method: 'POST',
        path: `/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        body: {
          contents: [{ role: 'user', parts: [{ text: payload.messages?.map(m => m.content).join('\n') || payload.prompt }] }],
          generationConfig: {
            temperature: payload.temperature ?? 0.7,
            maxOutputTokens: payload.max_tokens ?? 2048,
            topP: 0.9,
            topK: 40,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          ],
        },
      }),
      transformResponse: (data) => ({
        choices: [{
          message: { content: data.candidates?.[0]?.content?.parts?.[0]?.text || '' },
          finish_reason: data.candidates?.[0]?.finishReason?.toLowerCase() || 'stop',
        }],
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
          completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: data.usageMetadata?.totalTokenCount || 0,
        },
      }),
    });

    // OpenAI-compatible (for Ollama, vLLM, etc.)
    this.providers.set('openai', {
      name: 'OpenAI',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      transformRequest: (model, payload) => ({
        method: 'POST',
        path: '/chat/completions',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: { model, messages: payload.messages, temperature: payload.temperature, max_tokens: payload.max_tokens },
      }),
      transformResponse: (data) => data, // Already OpenAI format
    });

    // Anthropic (if needed)
    this.providers.set('anthropic', {
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      transformRequest: (model, payload) => ({
        method: 'POST',
        path: '/messages',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: {
          model,
          messages: payload.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
          system: payload.messages.find(m => m.role === 'system')?.content,
          max_tokens: payload.max_tokens ?? 2048,
          temperature: payload.temperature ?? 0.7,
        },
      }),
      transformResponse: (data) => ({
        choices: [{ message: { content: data.content?.[0]?.text || '' }, finish_reason: data.stop_reason }],
        usage: { prompt_tokens: data.usage?.input_tokens || 0, completion_tokens: data.usage?.output_tokens || 0, total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) },
      }),
    });
  }

  registerProvider(id, config) {
    this.providers.set(id, config);
  }

  async chat(providerId, model, payload, options = {}) {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const request = provider.transformRequest(model, payload);
    const url = new URL(request.path, provider.baseUrl);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: request.method,
        headers: { 'Content-Type': 'application/json', ...request.headers },
        timeout: options.timeout || 120000,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode >= 400) {
              const err = data.error?.message || `HTTP ${res.statusCode}: ${body}`;
              return reject(new Error(err));
            }
            const result = provider.transformResponse(data);
            resolve(result);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}\nBody: ${body.slice(0, 500)}`));
          }
        });
      });

      req.on('error', e => reject(new Error(`Network error: ${e.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

      req.write(JSON.stringify(request.body));
      req.end();
    });
  }

  getAvailableProviders() {
    const available = [];
    for (const [id, provider] of this.providers) {
      // Check if API key is available for cloud providers
      if (id === 'google' && process.env.GEMINI_API_KEY) available.push({ id, name: provider.name });
      else if (id === 'openai' && process.env.OPENAI_API_KEY) available.push({ id, name: provider.name });
      else if (id === 'anthropic' && process.env.ANTHROPIC_API_KEY) available.push({ id, name: provider.name });
    }
    return available;
  }
}

export const cloudClient = new CloudAIClient();