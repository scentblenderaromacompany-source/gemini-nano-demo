// WebMCP Content Script
// Runs on web pages to register tools that AI agents can discover and call
// WebMCP (W3C Community Group Draft) — Chrome 149+

console.log('[WebMCP] Content script loaded');

const WEBMCP_TOOLS = [
    {
        name: 'search_page',
        description: 'Search for text on the current page',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                caseSensitive: { type: 'boolean', default: false }
            },
            required: ['query']
        },
        execute: async ({ query, caseSensitive = false }) => {
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                { acceptNode: (node) => {
                    const p = node.parentElement;
                    if (!p || ['SCRIPT','STYLE','NOSCRIPT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
                    const s = window.getComputedStyle(p);
                    if (s.display === 'none' || s.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                } }
            );
            const matches = [];
            let node;
            const searchText = caseSensitive ? query : query.toLowerCase();
            while ((node = walker.nextNode())) {
                const text = node.textContent;
                const haystack = caseSensitive ? text : text.toLowerCase();
                if (haystack.includes(searchText)) {
                    matches.push({
                        text: text.trim().substring(0, 200),
                        xpath: getXPath(node.parentElement)
                    });
                }
            }
            return { matches: matches.slice(0, 20), total: matches.length };
        }
    },
    {
        name: 'extract_links',
        description: 'Extract all links from the page',
        parameters: {
            type: 'object',
            properties: {
                filter: { type: 'string', description: 'Optional filter for href (e.g., "github.com")' }
            }
        },
        execute: async ({ filter = '' }) => {
            const links = Array.from(document.querySelectorAll('a[href]'))
                .map(a => ({ text: a.textContent.trim(), href: a.href, title: a.title }))
                .filter(l => l.text && (!filter || l.href.includes(filter)));
            return { links: links.slice(0, 50), total: links.length };
        }
    },
    {
        name: 'extract_forms',
        description: 'Extract all forms and their fields from the page',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
            const forms = Array.from(document.querySelectorAll('form')).map(form => ({
                action: form.action,
                method: form.method,
                fields: Array.from(form.querySelectorAll('input,select,textarea')).map(el => ({
                    name: el.name,
                    type: el.type,
                    placeholder: el.placeholder,
                    required: el.required,
                    value: el.value
                }))
            }));
            return { forms };
        }
    },
    {
        name: 'click_element',
        description: 'Click an element by CSS selector',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector' }
            },
            required: ['selector']
        },
        execute: async ({ selector }) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error(`Element not found: ${selector}`);
            el.click();
            return { clicked: true, selector, tagName: el.tagName, text: el.textContent?.trim()?.substring(0, 100) };
        }
    },
    {
        name: 'fill_form',
        description: 'Fill form fields by name',
        parameters: {
            type: 'object',
            properties: {
                values: { type: 'object', description: 'Object mapping field names to values', additionalProperties: { type: 'string' } }
            },
            required: ['values']
        },
        execute: async ({ values }) => {
            const results = [];
            for (const [name, value] of Object.entries(values)) {
                const el = document.querySelector(`[name="${name}"]`);
                if (el) {
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    results.push({ name, filled: true });
                } else {
                    results.push({ name, filled: false, reason: 'Not found' });
                }
            }
            return { results };
        }
    },
    {
        name: 'get_page_metadata',
        description: 'Get page metadata (title, description, Open Graph, etc.)',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
            const meta = {};
            document.querySelectorAll('meta').forEach(m => {
                const name = m.getAttribute('name') || m.getAttribute('property');
                const content = m.getAttribute('content');
                if (name && content) meta[name] = content;
            });
            return {
                title: document.title,
                url: window.location.href,
                meta,
                headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => ({ level: h.tagName, text: h.textContent.trim() })).slice(0, 20)
            };
        }
    },
    {
        name: 'scroll_to',
        description: 'Scroll to an element or position',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector to scroll to' },
                y: { type: 'number', description: 'Or absolute Y position' }
            }
        },
        execute: async ({ selector, y }) => {
            if (selector) {
                const el = document.querySelector(selector);
                if (!el) throw new Error(`Element not found: ${selector}`);
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return { scrolled: true, selector };
            }
            if (typeof y === 'number') {
                window.scrollTo({ top: y, behavior: 'smooth' });
                return { scrolled: true, y };
            }
            throw new Error('Provide selector or y');
        }
    },
    {
        name: 'screenshot_area',
        description: 'Capture a screenshot of an element (returns base64 PNG)',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of element to capture' }
            },
            required: ['selector']
        },
        execute: async ({ selector }) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error(`Element not found: ${selector}`);
            // Note: Full screenshot requires OffscreenCanvas or canvas drawImage
            // This is a placeholder - real implementation needs canvas
            return { captured: false, reason: 'Requires canvas implementation', selector };
        }
    }
];

function getXPath(element) {
    if (!element) return '';
    if (element.id) return `//*[@id="${element.id}"]`;
    const parts = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === element.tagName) index++;
            sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${element.tagName.toLowerCase()}[${index}]`);
        element = element.parentElement;
    }
    return '/' + parts.join('/');
}

// Register tools with WebMCP (imperative API)
async function registerWebMCPTools() {
    if (typeof navigator.webMCP === 'undefined') {
        console.log('[WebMCP] navigator.webMCP not available (Chrome < 149 or flag disabled)');
        return false;
    }

    try {
        await navigator.webMCP.registerTools(WEBMCP_TOOLS);
        console.log('[WebMCP] Registered', WEBMCP_TOOLS.length, 'tools');
        return true;
    } catch (e) {
        console.error('[WebMCP] Registration failed:', e);
        return false;
    }
}

// Listen for tool calls from the extension
window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data.type === 'WEBMCP_CALL') {
        const { toolName, args, requestId } = event.data;
        const tool = WEBMCP_TOOLS.find(t => t.name === toolName);
        if (!tool) {
            window.postMessage({ type: 'WEBMCP_RESULT', requestId, error: `Tool not found: ${toolName}` }, '*');
            return;
        }
        try {
            const result = await tool.execute(args);
            window.postMessage({ type: 'WEBMCP_RESULT', requestId, result }, '*');
        } catch (e) {
            window.postMessage({ type: 'WEBMCP_RESULT', requestId, error: e.message }, '*');
        }
    }
});

// Auto-register on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerWebMCPTools);
} else {
    registerWebMCPTools();
}

// Also expose for manual registration
window.WEBMCP_TOOLS = WEBMCP_TOOLS;
window.registerWebMCPTools = registerWebMCPTools;
