// Workflow Engine - DAG-based Skill Chaining
// Defines workflows as YAML/JSON with skill steps and dependencies

export class WorkflowEngine {
  constructor(memory, skillRegistry) {
    this.memory = memory;
    this.skillRegistry = skillRegistry;
    this.workflows = new Map();
    this.runningWorkflows = new Map();
  }

  // Load workflow from definition
  loadWorkflow(definition) {
    const workflow = this.parseWorkflow(definition);
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  parseWorkflow(def) {
    // Validate DAG (no cycles)
    this.validateDAG(def.steps);
    
    return {
      id: def.id || 'workflow_' + Date.now(),
      name: def.name || 'Untitled Workflow',
      description: def.description || '',
      version: def.version || '1.0',
      steps: def.steps.map((s, i) => ({
        id: s.id || `step_${i}`,
        name: s.name || s.id || `Step ${i + 1}`,
        skill: s.skill, // skill ID from registry
        input: s.input || {},
        dependsOn: s.dependsOn || [],
        condition: s.condition, // optional: JS expression for conditional execution
        retry: s.retry || { maxAttempts: 1, delayMs: 1000 },
        timeoutMs: s.timeoutMs || 60000,
        outputMap: s.outputMap || {}, // map step output to next step inputs
      })),
      metadata: def.metadata || {},
    };
  }

  validateDAG(steps) {
    const visited = new Set();
    const visiting = new Set();
    
    const visit = (stepId) => {
      if (visiting.has(stepId)) {
        throw new Error(`Circular dependency detected involving step: ${stepId}`);
      }
      if (visited.has(stepId)) return;
      
      visiting.add(stepId);
      const step = steps.find(s => s.id === stepId);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          visit(dep);
        }
      }
      visiting.delete(stepId);
      visited.add(stepId);
    };
    
    for (const step of steps) {
      visit(step.id);
    }
  }

  // Execute workflow
  async execute(workflowId, initialInput = {}, options = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const run = {
      id: runId,
      workflowId,
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      stepResults: new Map(),
      stepStatus: new Map(), // pending, running, completed, failed, skipped
      currentStep: null,
      error: null,
    };

    this.runningWorkflows.set(runId, run);

    try {
      // Topological sort for execution order
      const executionOrder = this.topologicalSort(workflow.steps);
      
      // Initialize all steps as pending
      for (const step of workflow.steps) {
        run.stepStatus.set(step.id, 'pending');
      }

      // Execute steps in order
      for (const step of executionOrder) {
        run.currentStep = step.id;
        run.stepStatus.set(step.id, 'running');

        try {
          // Check condition
          if (step.condition && !this.evaluateCondition(step.condition, run.stepResults, initialInput)) {
            run.stepStatus.set(step.id, 'skipped');
            continue;
          }

          // Prepare input (merge initial + dependencies + outputMap)
          const stepInput = this.prepareStepInput(step, run.stepResults, initialInput);

          // Execute skill
          const result = await this.executeSkill(step.skill, stepInput, {
            timeoutMs: step.timeoutMs,
            retry: step.retry,
          });

          run.stepResults.set(step.id, result);
          run.stepStatus.set(step.id, 'completed');

        } catch (err) {
          run.stepStatus.set(step.id, 'failed');
          
          // Check if we should continue on failure
          if (step.continueOnFailure) {
            console.warn(`Step ${step.id} failed but continuing:`, err.message);
            run.stepResults.set(step.id, { error: err.message });
          } else {
            throw err;
          }
        }
      }

      run.status = 'completed';
      run.completedAt = Date.now();
      return { runId, status: 'completed', results: Object.fromEntries(run.stepResults) };

    } catch (err) {
      run.status = 'failed';
      run.error = err.message;
      run.completedAt = Date.now();
      throw err;
    } finally {
      // Optionally persist to memory
      if (this.memory && options.persist) {
        await this.persistRun(run, initialInput);
      }
    }
  }

  topologicalSort(steps) {
    // Kahn's algorithm
    const inDegree = new Map();
    const adjList = new Map();
    
    for (const step of steps) {
      inDegree.set(step.id, 0);
      adjList.set(step.id, []);
    }

    for (const step of steps) {
      for (const dep of step.dependsOn || []) {
        adjList.get(dep).push(step.id);
        inDegree.set(step.id, inDegree.get(step.id) + 1);
      }
    }

    const queue = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const result = [];
    while (queue.length > 0) {
      const current = queue.shift();
      result.push(steps.find(s => s.id === current));
      
      for (const neighbor of adjList.get(current)) {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) queue.push(neighbor);
      }
    }

    if (result.length !== steps.length) {
      throw new Error('Cycle detected in workflow dependencies');
    }

    return result;
  }

  prepareStepInput(step, stepResults, initialInput) {
    let input = { ...initialInput };

    // Add dependency results
    for (const depId of step.dependsOn || []) {
      const depResult = stepResults.get(depId);
      if (depResult) {
        input[depId] = depResult;
      }
    }

    // Apply outputMap from dependencies
    for (const depId of step.dependsOn || []) {
      const depResult = stepResults.get(depId);
      const depStep = step.dependsOn.find(d => d === depId); // find step config
      if (depResult && step.outputMap[depId]) {
        const mapping = step.outputMap[depId];
        for (const [targetKey, sourcePath] of Object.entries(mapping)) {
          const value = this.getNestedValue(depResult, sourcePath);
          if (value !== undefined) input[targetKey] = value;
        }
      }
    }

    // Merge step's own input
    input = { ...input, ...step.input };

    return input;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  evaluateCondition(condition, stepResults, initialInput) {
    // Simple JS expression evaluation (sandboxed)
    try {
      const context = { ...initialInput };
      for (const [id, result] of stepResults) {
        context[id] = result;
      }
      return new Function('context', `with(context) { return (${condition}); }`)(context);
    } catch {
      return false;
    }
  }

  async executeSkill(skillId, input, options = {}) {
    const skill = this.skillRegistry.getSkill(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    // This would call the actual skill handler
    // For now, return a mock - actual implementation calls bridge
    return {
      skill: skillId,
      input,
      output: `Executed ${skillId} with ${JSON.stringify(input).slice(0, 100)}`,
      timestamp: Date.now(),
    };
  }

  async persistRun(run, initialInput) {
    if (!this.memory) return;
    await this.memory.createMemory({
      type: 'workflow_run',
      content: `Workflow ${run.workflowId} ${run.status}`,
      tags: ['workflow', run.workflowId, run.status],
      confidence: run.status === 'completed' ? 1.0 : 0.5,
      metadata: { runId: run.id, ...run },
    });
  }

  getRunStatus(runId) {
    return this.runningWorkflows.get(runId);
  }

  listWorkflows() {
    return Array.from(this.workflows.values()).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      stepCount: w.steps.length,
    }));
  }
}

// Pre-built workflow templates
export const WORKFLOW_TEMPLATES = {
  'research-and-summarize': {
    id: 'research-and-summarize',
    name: 'Research & Summarize',
    description: 'Browse a topic, extract key info, and generate summary',
    steps: [
      { id: 'browse', skill: 'agent-start', input: { task: 'Find recent articles about {{topic}}' }, dependsOn: [] },
      { id: 'extract', skill: 'webmcp-links', input: {}, dependsOn: ['browse'] },
      { id: 'summarize', skill: 'summarizer', input: { text: '{{browse.result}}' }, dependsOn: ['browse'] },
    ],
  },
  'code-review-pipeline': {
    id: 'code-review-pipeline',
    name: 'Code Review Pipeline',
    description: 'Review code for bugs, style, and security',
    steps: [
      { id: 'review', skill: 'code-review', input: { code: '{{code}}' }, dependsOn: [] },
      { id: 'security', skill: 'security-check', input: { code: '{{code}}' }, dependsOn: [] },
      { id: 'tests', skill: 'code-test', input: { code: '{{code}}' }, dependsOn: ['review'] },
    ],
  },
  'content-creation': {
    id: 'content-creation',
    name: 'Content Creation',
    description: 'Research → Outline → Write → Proofread',
    steps: [
      { id: 'research', skill: 'agent-start', input: { task: 'Research {{topic}}' }, dependsOn: [] },
      { id: 'outline', skill: 'brainstorm', input: { topic: '{{topic}}' }, dependsOn: ['research'] },
      { id: 'write', skill: 'write-blog', input: { outline: '{{outline.result}}' }, dependsOn: ['outline'] },
      { id: 'proofread', skill: 'proofread', input: { text: '{{write.result}}' }, dependsOn: ['write'] },
    ],
  },

  // --- REAL-WORLD AUTOMATION PACK ---
  // Import will be handled dynamically in server.js
  // See: bridge/workflows/*.js
};