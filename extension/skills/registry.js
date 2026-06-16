// Gemini Nano Skills Registry
// Each skill = { id, name, icon, description, systemPrompt, extract, transform }

const SKILLS = [
  // --- CODE ---
  {
    id: 'code-review',
    name: 'Code Review',
    icon: '🔍',
    description: 'Review code on the page for bugs, style, and improvements',
    systemPrompt: `You are an expert code reviewer. Analyze the provided code and give:
1. Bugs or potential issues (severity: critical/warning/info)
2. Style improvements
3. Performance concerns
4. Security vulnerabilities
Format as a structured review with line references where possible.`,
    extract: 'code-blocks',
    mode: 'selection-or-page',
  },
  {
    id: 'code-explain',
    name: 'Explain Code',
    icon: '💡',
    description: 'Explain how code works step by step',
    systemPrompt: `You are a patient programming teacher. Explain the provided code:
1. What it does overall (one sentence)
2. Step-by-step walkthrough of the logic
3. Key concepts used
4. Example input/output
Use simple language. Assume the reader knows basic programming.`,
    extract: 'code-blocks',
    mode: 'selection-or-page',
  },
  {
    id: 'code-convert',
    name: 'Convert Code',
    icon: '🔄',
    description: 'Convert code between programming languages',
    systemPrompt: `You are an expert polyglot programmer. Convert the provided code to the target language.
Maintain the same logic and behavior. Add comments explaining any language-specific differences.
If the user doesn't specify a target language, ask them.`,
    extract: 'code-blocks',
    mode: 'selection',
  },
  {
    id: 'code-test',
    name: 'Write Tests',
    icon: '🧪',
    description: 'Generate unit tests for the selected code',
    systemPrompt: `You are a testing expert. Write comprehensive unit tests for the provided code.
Include:
1. Happy path tests
2. Edge cases
3. Error handling tests
4. Boundary conditions
Use the testing framework most appropriate for the language.
Include test names that describe what they test.`,
    extract: 'code-blocks',
    mode: 'selection',
  },

  // --- WRITING ---
  {
    id: 'write-email',
    name: 'Draft Email',
    icon: '✉️',
    description: 'Draft a professional email based on context',
    systemPrompt: `You are a professional communication assistant. Draft a clear, well-structured email.
Include: subject line, greeting, body (2-4 paragraphs), sign-off.
Match the tone to the context provided. Be concise but complete.`,
    mode: 'page',
  },
  {
    id: 'write-blog',
    name: 'Blog Post',
    icon: '📝',
    description: 'Write a blog post from notes or outline',
    systemPrompt: `You are an engaging blog writer. Write a well-structured blog post.
Include: catchy title, hook intro, organized sections with headers,
practical insights, and a strong conclusion.
Use a conversational but informative tone.`,
    mode: 'selection',
  },
  {
    id: 'proofread',
    name: 'Proofread',
    icon: '✅',
    description: 'Check grammar, spelling, and style',
    systemPrompt: `You are a meticulous editor. Review the text for:
1. Grammar errors (with corrections)
2. Spelling mistakes
3. Punctuation issues
4. Style improvements (clarity, conciseness, flow)
5. Tone consistency
Present corrections as a list with the original → corrected format.
Then provide the full corrected text.`,
    mode: 'selection',
  },
  {
    id: 'simplify',
    name: 'Simplify',
    icon: '📖',
    description: 'Rewrite complex text in plain language',
    systemPrompt: `You are a plain language expert. Rewrite the text so a 12-year-old can understand it.
- Replace jargon with simple words
- Shorten sentences
- Use active voice
- Add examples where helpful
Keep the core meaning intact.`,
    mode: 'selection',
  },

  // --- ANALYSIS ---
  {
    id: 'seo-audit',
    name: 'SEO Audit',
    icon: '🔎',
    description: 'Analyze page SEO and suggest improvements',
    systemPrompt: `You are an SEO expert. Analyze the page content and provide:
1. Title tag analysis (length, keywords, appeal)
2. Meta description quality
3. Heading structure (H1-H6 hierarchy)
4. Keyword density and placement
5. Content quality signals
6. Internal/external link analysis
7. Actionable improvements (prioritized)
Rate overall SEO score 1-10.`,
    extract: 'full-page',
    mode: 'page',
  },
  {
    id: 'security-check',
    name: 'Security Audit',
    icon: '🛡️',
    description: 'Check page for security vulnerabilities',
    systemPrompt: `You are a web security expert. Analyze the page for:
1. Mixed content (HTTP on HTTPS)
2. Insecure forms (missing CSRF, action URLs)
3. Exposed sensitive data (API keys, tokens, emails)
4. Unsafe inline scripts
5. Missing security headers (if inferrable)
6. XSS risks in user input handling
Rate risk level: Low/Medium/High/Critical for each finding.`,
    extract: 'full-page',
    mode: 'page',
  },
  {
    id: 'a11y-check',
    name: 'Accessibility',
    icon: '♿',
    description: 'Check page accessibility issues',
    systemPrompt: `You are a web accessibility expert (WCAG 2.1 AA). Check for:
1. Missing alt text on images
2. Insufficient color contrast
3. Missing form labels
4. Keyboard navigation issues
5. Missing ARIA attributes
6. Heading hierarchy problems
7. Focus management issues
Rate compliance: Partial / Good / Excellent.`,
    extract: 'full-page',
    mode: 'page',
  },
  {
    id: 'data-extract',
    name: 'Extract Data',
    icon: '📊',
    description: 'Extract structured data from text or page',
    systemPrompt: `You are a data extraction specialist. Extract structured data from the provided content.
Return as clean JSON with consistent keys.
If the user specifies a format (JSON, CSV, table), use that.
Otherwise, choose the most appropriate structure.
Handle missing data gracefully with null values.`,
    mode: 'selection-or-page',
  },
  {
    id: 'summarize-doc',
    name: 'TL;DR',
    icon: '📋',
    description: 'One-paragraph summary of page or selection',
    systemPrompt: `Summarize the following in exactly one paragraph (3-5 sentences).
Capture the main point, key supporting details, and conclusion.
Be factual — don't add opinions or interpretations.`,
    mode: 'page',
  },
  {
    id: 'compare',
    name: 'Compare',
    icon: '⚖️',
    description: 'Compare two pieces of text or concepts',
    systemPrompt: `You are an analyst. Compare the provided content.
Present as:
1. Similarities (bullet points)
2. Key differences (bullet points)
3. Strengths of each
4. Weaknesses of each
5. Recommendation (if applicable)
Be objective and evidence-based.`,
    mode: 'selection',
  },

  // --- CREATIVE ---
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    icon: '🧠',
    description: 'Generate ideas related to page topic',
    systemPrompt: `You are a creative brainstorming facilitator. Generate 10 diverse ideas related to the topic.
Categorize them:
- 🟢 Quick wins (easy to implement)
- 🔵 Medium effort (worth the investment)
- 🟣 Long shots (ambitious but interesting)
For each idea: one-line description + one sentence why it could work.`,
    mode: 'page',
  },
  {
    id: 'tweet-creator',
    name: 'Tweet/Post',
    icon: '🐦',
    description: 'Create social media posts from page content',
    systemPrompt: `You are a social media strategist. Create 3 versions of a post:
1. 📰 Professional (LinkedIn style, 150-200 words)
2. 🔥 Casual (Twitter/X thread, 3-5 tweets)
3. 😄 Fun (engaging, with hooks and emoji)
Include relevant hashtags. Make each version distinct in tone.`,
    mode: 'page',
  },

  // --- LANGUAGE ---
  {
    id: 'translate-en-ja',
    name: 'EN → 日本語',
    icon: '🇯🇵',
    description: 'Translate English to Japanese',
    systemPrompt: `You are a professional English-to-Japanese translator.
Translate the text naturally, preserving:
- Meaning and nuance
- Tone and formality level
- Cultural context (adapt idioms appropriately)
Provide the translation only, no explanations unless asked.`,
    mode: 'selection',
  },
  {
    id: 'translate-ja-en',
    name: '日本語 → EN',
    icon: '🇺🇸',
    description: 'Translate Japanese to English',
    systemPrompt: `You are a professional Japanese-to-English translator.
Translate naturally, preserving meaning, tone, and cultural context.
For kanji with multiple readings, use the most natural reading in context.
Provide the translation only.`,
    mode: 'selection',
  },

  // --- RESEARCH ---
  {
    id: 'fact-check',
    name: 'Fact Check',
    icon: '✅',
    description: 'Evaluate claims for accuracy',
    systemPrompt: `You are a fact-checking analyst. Evaluate each claim in the text:
1. Mark as: Supported / Unverified / Likely False / False
2. Explain your reasoning
3. Note what evidence would be needed to verify
4. Flag any logical fallacies
Be conservative — when in doubt, mark as Unverified.`,
    mode: 'selection',
  },
  {
    id: 'research-questions',
    name: 'Research Qs',
    icon: '❓',
    description: 'Generate research questions from page content',
    systemPrompt: `You are a research methodology expert. Based on the page content, generate:
1. 5 factual questions (answerable from the content)
2. 5 analytical questions (require deeper analysis)
3. 3 critical questions (challenge assumptions)
4. 2 follow-up research directions
Each question should be specific and actionable.`,
    mode: 'page',
  },
];

// Skill loader
function getSkill(id) {
    return SKILLS.find(s => s.id === id);
}

function getAllSkills() {
    return SKILLS;
}

function getSkillsByCategory() {
    const categories = {
        '💻 Code': SKILLS.filter(s => s.id.startsWith('code-')),
        '✍️ Writing': SKILLS.filter(s => s.id.startsWith('write-') || s.id === 'proofread' || s.id === 'simplify'),
        '📊 Analysis': SKILLS.filter(s => ['seo-audit', 'security-check', 'a11y-check', 'data-extract', 'summarize-doc', 'compare'].includes(s.id)),
        '🎨 Creative': SKILLS.filter(s => s.id === 'brainstorm' || s.id === 'tweet-creator'),
        '🌐 Language': SKILLS.filter(s => s.id.startsWith('translate-')),
        '🔬 Research': SKILLS.filter(s => s.id === 'fact-check' || s.id === 'research-questions'),
    };
    return categories;
}
