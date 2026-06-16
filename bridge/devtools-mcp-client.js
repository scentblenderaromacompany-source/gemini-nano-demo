// DevTools MCP Client for Bridge
// Integrates chrome-devtools-mcp as an MCP server subprocess

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

export class DevToolsMCPClient {
  constructor(options = {}) {
    this.options = {
      autoConnect: options.autoConnect ?? true,
      browserUrl: options.browserUrl ?? 'http://127.0.0.1:9222',
      headless: options.headless ?? true,
      categories: ['performance', 'network', 'console', 'lighthouse', 'screencast'],
      ...options,
    };
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.initialized = false;
  }

  async start() {
    if (this.process) return;

    // Build command
    const args = ['mcp'];
    
    // Connection options
    if (this.options.browserUrl) {
      args.push('--browserUrl', this.options.browserUrl);
    }
    
    // Category filters
    if (this.options.categories.includes('performance')) {
      args.push('--categoryPerformance', 'true');
    }
    if (this.options.categories.includes('network')) {
      args.push('--categoryNetwork', 'true');
    }
    if (this.options.categories.includes('console')) {
      args.push('--categoryExperimentalThirdParty', 'true');
    }
    if (this.options.categories.includes('lighthouse')) {
      args.push('--categoryExperimentalThirdParty', 'true');
    }
    if (this.options.categories.includes('screencast')) {
      args.push('--experimentalScreencast', 'true');
    }
    
    if (this.options.headless) {
      args.push('--headless', 'true');
    }
    
    if (this.options.autoConnect) {
      args.push('--autoConnect', 'true');
    }

    console.log('[DevToolsMCP] Starting:', 'npx', 'chrome-devtools-mcp@latest', args.join(' '));

    this.process = spawn('npx', ['chrome-devtools-mcp@latest', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DEBUG: 'chrome-devtools-mcp:*' },
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg);
          } catch (e) {
            // Skip non-JSON output (logs)
          }
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      console.error('[DevToolsMCP stderr]:', data.toString());
    });

    this.process.on('close', (code) => {
      console.log('[DevToolsMCP] Process exited:', code);
      this.initialized = false;
      this.process = null;
    });

    // Wait for initialization
    await this.waitForInit();
    
    // Initialize MCP
    await this.initializeMCP();
    
    this.initialized = true;
    return this;
  }

  waitForInit(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools MCP init timeout')), timeout);
      
      const checkInit = () => {
        if (this.initialized) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(checkInit, 100);
        }
      };
      
      // Listen for initialization message
      this.process.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.method === 'initialized' || (msg.id && msg.result)) {
              this.initialized = true;
            }
          } catch {}
        }
      });
      
      checkInit();
    });
  }

  async initializeMCP() {
    // Send initialize request
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gemini-nano-bridge', version: '1.0.0' },
    });
    return result;
  }

  async sendRequest(method, params = {}) {
    if (!this.process) throw new Error('DevTools MCP not started');
    
    const id = this.requestId++;
    
    const message = { jsonrpc: '2.0', id, method, params };
    this.process.stdin.write(JSON.stringify(message) + '\n');
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      
      // Timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 60000);
    });
  }

  handleMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  }

  // High-level API methods
  async getPerformanceTrace(options = {}) {
    return this.sendRequest('tools/call', {
      name: 'performance.trace',
      arguments: { 
        duration: options.duration || 5000,
        categories: options.categories || ['loading', 'scripting', 'rendering'],
      },
    });
  }

  async getNetworkRequests(options = {}) {
    return this.sendRequest('tools/call', {
      name: 'network.requests',
      arguments: { 
        filter: options.filter,
        includeBody: options.includeBody ?? false,
      },
    });
  }

  async getConsoleLogs(options = {}) {
    return this.sendRequest('tools/call', {
      name: 'console.logs',
      arguments: { 
        level: options.level || 'all',
        limit: options.limit || 100,
      },
    });
  }

  async runLighthouseAudit(options = {}) {
    return this.sendRequest('tools/call', {
      name: 'lighthouse.audit',
      arguments: { 
        url: options.url,
        categories: options.categories || ['performance', 'accessibility', 'best-practices', 'seo'],
        device: options.device || 'desktop',
      },
    });
  }

  async takeScreenshot(options = {}) {
    return this.sendRequest('tools/call', {
      name: 'screencast.capture',
      arguments: { 
        format: options.format || 'png',
        quality: options.quality || 80,
      },
    });
  }

  async evaluateJavaScript(expression, options = {}) {
    return this.sendRequest('tools/call', {
      name: 'runtime.evaluate',
      arguments: { 
        expression,
        awaitPromise: options.awaitPromise ?? true,
        returnByValue: options.returnByValue ?? true,
      },
    });
  }

  async getPageMetrics() {
    return this.sendRequest('tools/call', {
      name: 'page.metrics',
      arguments: {},
    });
  }

  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.initialized = false;
    }
  }
}

// Singleton instance
let devToolsClient = null;

export async function getDevToolsClient(options = {}) {
  if (!devToolsClient) {
    devToolsClient = new DevToolsMCPClient(options);
    await devToolsClient.start();
  }
  return devToolsClient;
}