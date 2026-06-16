// Research Report Workflow Template
// Topic -> browse -> extract -> synthesize -> format report

export const researchReportWorkflow = {
  id: 'research-report',
  name: 'Research Report Generator',
  description: 'Comprehensive research report from topic to formatted document',
  version: '1.0',
  steps: [
    {
      id: 'plan-research',
      name: 'Plan Research Strategy',
      skill: 'research-questions',
      input: {
        topic: '{{topic}}',
      },
      dependsOn: [],
      outputMap: {
        planResearch: {
          questions: 'researchQuestions',
        },
      },
    },
    {
      id: 'browse-sources',
      name: 'Browse Sources',
      skill: 'agent-start',
      input: {
        task: 'Research "{{topic}}" using the following questions:\n{{planResearch.questions}}\n\nVisit authoritative sources (Wikipedia, academic papers, official docs, reputable news). Extract key facts, statistics, and citations.',
      },
      dependsOn: ['plan-research'],
      outputMap: {
        browseSources: {
          rawFindings: 'sourceData',
        },
      },
    },
    {
      id: 'extract-facts',
      name: 'Extract Structured Facts',
      skill: 'data-extract',
      input: {
        data: '{{browseSources.rawFindings}}',
        format: 'json',
        schema: {
          keyFacts: 'array',
          statistics: 'array',
          sources: 'array',
          quotes: 'array',
        },
      },
      dependsOn: ['browse-sources'],
      outputMap: {
        extractFacts: {
          structuredData: 'extractedFacts',
        },
      },
    },
    {
      id: 'synthesize',
      name: 'Synthesize Report',
      skill: 'write-blog',
      input: {
        topic: '{{topic}}',
        outline: '{{extractFacts.structuredData}}',
        style: 'professional report with executive summary, sections, and citations',
      },
      dependsOn: ['extract-facts'],
      outputMap: {
        synthesize: {
          draft: 'reportDraft',
        },
      },
    },
    {
      id: 'proofread-final',
      name: 'Proofread & Polish',
      skill: 'proofread',
      input: {
        text: '{{synthesize.draft}}',
      },
      dependsOn: ['synthesize'],
      outputMap: {
        proofreadFinal: {
          finalReport: 'finalReport',
        },
      },
    },
  ],
  metadata: {
    category: 'research',
    tags: ['research', 'report', 'analysis', 'writing'],
    requiredParams: ['topic'],
    estimatedDuration: '3-8 minutes',
  },
};