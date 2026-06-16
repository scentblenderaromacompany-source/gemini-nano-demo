// Hybrid AI Configuration
// goo.gle/hybrid-sdk-developer-preview pattern

export const HYBRID_CONFIG = {
  // Model tiers (local → cloud escalation)
  tiers: [
    {
      id: 'nano',
      name: 'Gemini Nano (on-device)',
      provider: 'local',
      endpoint: '/v1/chat/completions',
      maxTokens: 2048,
      costPer1k: 0,
      latencyMs: 500,
      capabilities: ['text', 'chat', 'summarize', 'translate', 'code'],
      availability: () => typeof LanguageModel !== 'undefined' && LanguageModel.availability() === 'available',
    },
    {
      id: 'gemini-1.5-flash',
      name: 'Gemini 1.5 Flash (cloud)',
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      maxTokens: 8192,
      costPer1k: 0.00015, // ~$0.15/M tokens
      latencyMs: 800,
      capabilities: ['text', 'chat', 'reasoning', 'code', 'long-context', 'multimodal'],
      apiKeyEnv: 'GEMINI_API_KEY',
    },
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro (cloud)',
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent',
      maxTokens: 32768,
      costPer1k: 0.00125, // ~$1.25/M tokens
      latencyMs: 1200,
      capabilities: ['text', 'chat', 'deep-reasoning', 'code', 'long-context', 'multimodal'],
      apiKeyEnv: 'GEMINI_API_KEY',
    },
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash (cloud)',
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
      maxTokens: 8192,
      costPer1k: 0.00015,
      latencyMs: 600,
      capabilities: ['text', 'chat', 'reasoning', 'code', 'tool-use', 'multimodal'],
      apiKeyEnv: 'GEMINI_API_KEY',
    },
  ],

  // Task complexity thresholds for auto model selection
  complexity: {
    simple: { maxTokens: 500, keywords: ['summarize', 'translate', 'detect', 'extract', 'quick'] },
    medium: { maxTokens: 2000, keywords: ['explain', 'analyze', 'review', 'write', 'generate'] },
    complex: { maxTokens: 4000, keywords: ['reason', 'plan', 'strategy', 'architecture', 'debug', 'research'] },
    veryComplex: { maxTokens: 8000, keywords: ['multi-step', 'agent', 'workflow', 'pipeline', 'orchestrat'] },
  },

  // Failover rules
  failover: {
    onError: true,
    onTimeout: true,
    onUnavailable: true,
    maxRetries: 2,
    retryDelayMs: 1000,
  },

  // Cost controls
  budget: {
    dailyLimitUsd: 1.00,
    warnThreshold: 0.80,
  },

  // Default model preferences
  defaults: {
    chat: 'auto',
    agent: 'auto',
    vision: 'gemini-1.5-flash', // Nano doesn't do vision well yet
    longContext: 'gemini-1.5-pro',
  },
};

// Model selector based on task analysis
export function selectModel(task, preferredModel = 'auto', context = {}) {
  if (preferredModel !== 'auto') {
    return HYBRID_CONFIG.tiers.find(t => t.id === preferredModel) || HYBRID_CONFIG.tiers[0];
  }

  // Analyze task complexity
  const taskLower = task.toLowerCase();
  let complexity = 'simple';

  for (const [level, config] of Object.entries(HYBRID_CONFIG.complexity)) {
    if (config.keywords.some(k => taskLower.includes(k))) {
      complexity = level;
      break;
    }
  }

  // Check context hints
  if (context.longContext || context.tokens > 4000) complexity = 'veryComplex';
  if (context.vision || context.images) complexity = 'complex';
  if (context.agentLoop) complexity = 'complex';

  // Map complexity to model
  const modelMap = {
    simple: 'nano',
    medium: 'nano',
    complex: 'gemini-1.5-flash',
    veryComplex: 'gemini-1.5-pro',
  };

  const modelId = modelMap[complexity] || 'nano';
  const model = HYBRID_CONFIG.tiers.find(t => t.id === modelId);

  // Fallback to nano if preferred unavailable
  if (!model || (model.provider === 'cloud' && !process.env[model.apiKeyEnv])) {
    return HYBRID_CONFIG.tiers[0]; // nano
  }

  return model;
}

// Estimate task complexity score (0-1)
export function estimateComplexity(task, context = {}) {
  let score = 0;
  const taskLower = task.toLowerCase();

  // Keyword scoring
  for (const [level, config] of Object.entries(HYBRID_CONFIG.complexity)) {
    const weight = { simple: 0.1, medium: 0.3, complex: 0.6, veryComplex: 0.9 }[level];
    if (config.keywords.some(k => taskLower.includes(k))) {
      score = Math.max(score, weight);
    }
  }

  // Context multipliers
  if (context.tokens > 2000) score = Math.min(1, score + 0.2);
  if (context.tokens > 8000) score = Math.min(1, score + 0.3);
  if (context.vision) score = Math.min(1, score + 0.2);
  if (context.agentLoop) score = Math.min(1, score + 0.2);
  if (context.multiStep) score = Math.min(1, score + 0.3);

  return score;
}

export function getModelById(id) {
  return HYBRID_CONFIG.tiers.find(t => t.id === id);
}

export function getAvailableModels() {
  return HYBRID_CONFIG.tiers.filter(t => {
    if (t.provider === 'local') return t.availability();
    return !!process.env[t.apiKeyEnv];
  });
}