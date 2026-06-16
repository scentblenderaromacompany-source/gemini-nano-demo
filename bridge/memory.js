// Memory System - SQLite + Embeddings for Agent Session Persistence
// Stores: sessions, steps, decisions, outcomes, embeddings for semantic search

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, 'agent-memory.db');

class AgentMemory {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    // Enable WAL mode for better concurrency
    await this.db.exec('PRAGMA journal_mode = WAL;');
    await this.db.exec('PRAGMA synchronous = NORMAL;');

    await this.createTables();
    return this;
  }

  async createTables() {
    // Sessions table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        status TEXT NOT NULL, -- running, done, stuck, error, stopped
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        total_steps INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        result TEXT,
        error TEXT,
        tags TEXT, -- JSON array
        metadata TEXT -- JSON
      )
    `);

    // Steps table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        action TEXT NOT NULL, -- JSON
        action_result TEXT, -- JSON
        page_context TEXT, -- snapshot summary
        duration_ms INTEGER,
        tokens_used INTEGER,
        model_used TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // Memories table (learned patterns, facts, preferences)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- fact, pattern, preference, skill_result, error
        content TEXT NOT NULL,
        embedding TEXT, -- JSON array of floats
        session_id TEXT, -- optional link to originating session
        tags TEXT, -- JSON array
        confidence REAL DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      )
    `);

    // Embeddings table (for vector similarity search)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        vector TEXT NOT NULL, -- JSON array
        dimensions INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);

    // Indexes
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_steps_session ON steps(session_id);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_embeddings_memory ON embeddings(memory_id);
    `);
  }

  // Session CRUD
  async createSession(data) {
    const id = data.id || randomUUID();
    const now = Date.now();
    
    await this.db.run(
      `INSERT INTO sessions (id, task, status, model, created_at, updated_at, tags, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.task,
        data.status || 'running',
        data.model || 'auto',
        now,
        now,
        JSON.stringify(data.tags || []),
        JSON.stringify(data.metadata || {}),
      ]
    );
    
    return this.getSession(id);
  }

  async getSession(id) {
    return await this.db.get('SELECT * FROM sessions WHERE id = ?', id);
  }

  async updateSession(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
      }
    }
    
    if (fields.length === 0) return this.getSession(id);
    
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    await this.db.run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getSession(id);
  }

  async completeSession(id, result) {
    return this.updateSession(id, {
      status: 'done',
      result: typeof result === 'object' ? JSON.stringify(result) : result,
      completed_at: Date.now(),
    });
  }

  async listSessions(options = {}) {
    const { status, limit = 50, offset = 0, orderBy = 'created_at', orderDir = 'DESC' } = options;
    
    let query = 'SELECT * FROM sessions';
    const params = [];
    
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    
    query += ` ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    return await this.db.all(query, params);
  }

  async deleteSession(id) {
    // Cascades to steps via FK
    await this.db.run('DELETE FROM sessions WHERE id = ?', id);
  }

  // Step CRUD
  async addStep(sessionId, stepData) {
    const id = randomUUID();
    const now = Date.now();
    
    await this.db.run(
      `INSERT INTO steps (id, session_id, step_number, action, action_result, page_context, duration_ms, tokens_used, model_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sessionId,
        stepData.stepNumber,
        JSON.stringify(stepData.action),
        stepData.actionResult ? JSON.stringify(stepData.actionResult) : null,
        stepData.pageContext || null,
        stepData.durationMs || null,
        stepData.tokensUsed || null,
        stepData.modelUsed || null,
        now,
      ]
    );
    
    // Update session step count
    await this.db.run(
      'UPDATE sessions SET total_steps = total_steps + 1, updated_at = ? WHERE id = ?',
      [now, sessionId]
    );
    
    return id;
  }

  async getSteps(sessionId) {
    return await this.db.all(
      'SELECT * FROM steps WHERE session_id = ? ORDER BY step_number',
      sessionId
    );
  }

  // Memory CRUD
  async createMemory(data) {
    const id = randomUUID();
    const now = Date.now();
    
    await this.db.run(
      `INSERT INTO memories (id, type, content, embedding, session_id, tags, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.type,
        data.content,
        data.embedding ? JSON.stringify(data.embedding) : null,
        data.sessionId || null,
        JSON.stringify(data.tags || []),
        data.confidence || 1.0,
        now,
        now,
      ]
    );
    
    // Store embedding separately for vector search
    if (data.embedding) {
      const embId = randomUUID();
      await this.db.run(
        `INSERT INTO embeddings (id, memory_id, vector, dimensions, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [embId, id, JSON.stringify(data.embedding), data.embedding.length, now]
      );
    }
    
    return this.getMemory(id);
  }

  async getMemory(id) {
    return await this.db.get('SELECT * FROM memories WHERE id = ?', id);
  }

  async searchMemories(query, options = {}) {
    const { type, sessionId, limit = 10, minConfidence = 0 } = options;
    
    let sql = 'SELECT * FROM memories WHERE confidence >= ?';
    const params = [minConfidence];
    
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    
    if (sessionId) {
      sql += ' AND session_id = ?';
      params.push(sessionId);
    }
    
    if (query) {
      sql += ' AND content LIKE ?';
      params.push(`%${query}%`);
    }
    
    sql += ' ORDER BY access_count DESC, created_at DESC LIMIT ?';
    params.push(limit);
    
    const results = await this.db.all(sql, params);
    
    // Increment access count
    for (const r of results) {
      await this.db.run(
        'UPDATE memories SET access_count = access_count + 1 WHERE id = ?',
        r.id
      );
    }
    
    return results;
  }

  async vectorSearch(queryEmbedding, options = {}) {
    const { limit = 10, threshold = 0.7 } = options;
    
    // Get all embeddings (for cosine similarity)
    const embeddings = await this.db.all(
      `SELECT e.memory_id, e.vector, m.content, m.type, m.tags, m.confidence
       FROM embeddings e
       JOIN memories m ON e.memory_id = m.id
       WHERE m.confidence >= ?`,
      [options.minConfidence || 0]
    );
    
    if (embeddings.length === 0) return [];
    
    // Compute cosine similarities
    const queryVec = queryEmbedding;
    const similarities = embeddings.map(e => {
      const vec = JSON.parse(e.vector);
      const similarity = cosineSimilarity(queryVec, vec);
      return { ...e, similarity };
    });
    
    return similarities
      .filter(s => s.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(s => ({ ...s, vector: undefined })); // Don't return vectors
  }

  // Session with full context
  async getSessionContext(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    
    const steps = await this.getSteps(sessionId);
    const memories = await this.db.all(
      'SELECT * FROM memories WHERE session_id = ? ORDER BY created_at',
      sessionId
    );
    
    return { session, steps, memories };
  }

  // Learning: extract patterns from completed sessions
  async learnFromSession(sessionId) {
    const context = await this.getSessionContext(sessionId);
    if (!context) return [];
    
    const { session, steps } = context;
    const learnings = [];
    
    // Extract successful patterns
    const successfulSteps = steps.filter(s => {
      const result = JSON.parse(s.action_result || '{}');
      return !result.error && result.status !== 'stuck';
    });
    
    for (const step of successfulSteps) {
      const action = JSON.parse(step.action);
      
      // Learn action patterns
      if (action.action === 'navigate') {
        learnings.push({
          type: 'pattern',
          content: `Navigation to ${action.url} succeeded with selector pattern`,
          tags: ['navigation', 'success', action.url],
          confidence: 0.8,
          sessionId,
        });
      }
      
      if (action.action === 'click' && action.ref) {
        learnings.push({
          type: 'pattern',
          content: `Click on ref ${action.ref} succeeded in context`,
          tags: ['click', 'success'],
          confidence: 0.8,
          sessionId,
        });
      }
      
      if (action.action === 'webmcp' && action.tool) {
        learnings.push({
          type: 'pattern',
          content: `WebMCP tool ${action.tool} succeeded with args: ${JSON.stringify(action.args)}`,
          tags: ['webmcp', action.tool, 'success'],
          confidence: 0.85,
          sessionId,
        });
      }
    }
    
    // Store learnings
    for (const learning of learnings) {
      await this.createMemory(learning);
    }
    
    return learnings;
  }

  // Stats
  async getStats() {
    const sessions = await this.db.all('SELECT status, COUNT(*) as count FROM sessions GROUP BY status');
    const totalSteps = await this.db.get('SELECT SUM(total_steps) as total FROM sessions');
    const totalMemories = await this.db.get('SELECT COUNT(*) as count FROM memories');
    
    return {
      sessions: sessions.reduce((acc, s) => ({ ...acc, [s.status]: s.count }), {}),
      totalSteps: totalSteps?.total || 0,
      totalMemories: totalMemories?.count || 0,
    };
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}

// Cosine similarity for vector search
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Singleton instance
let memoryInstance = null;

export async function getMemory(dbPath) {
  if (!memoryInstance) {
    memoryInstance = new AgentMemory(dbPath);
    await memoryInstance.init();
  }
  return memoryInstance;
}

export { AgentMemory, cosineSimilarity };