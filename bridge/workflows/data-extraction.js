// Data Extraction Pipeline Workflow Template
// Site -> paginate -> extract -> structure -> export

export const dataExtractionWorkflow = {
  id: 'data-extraction',
  name: 'Data Extraction Pipeline',
  description: 'Extract structured data from websites with pagination support',
  version: '1.0',
  steps: [
    {
      id: 'analyze-site',
      name: 'Analyze Site Structure',
      skill: 'agent-start',
      input: {
        task: 'Visit {{url}} and analyze: page structure, pagination mechanism, data selectors, and any anti-bot measures',
      },
      dependsOn: [],
      outputMap: {
        analyzeSite: {
          structure: 'siteStructure',
        },
      },
    },
    {
      id: 'extract-page-1',
      name: 'Extract First Page',
      skill: 'data-extract',
      input: {
        url: '{{url}}',
        selectors: '{{analyzeSite.structure.selectors}}',
        pagination: '{{analyzeSite.structure.pagination}}',
      },
      dependsOn: ['analyze-site'],
      outputMap: {
        extractPage1: {
          page1Data: 'firstPageData',
        },
      },
    },
    {
      id: 'paginate-extract',
      name: 'Paginate & Extract All',
      skill: 'agent-start',
      input: {
        task: 'Using the pagination pattern from {{analyzeSite.structure}}, visit all pages and extract data. Target: {{maxPages || "all"}} pages. Handle rate limiting and errors gracefully.',
      },
      dependsOn: ['extract-page-1'],
      outputMap: {
        paginateExtract: {
          allData: 'completeData',
        },
      },
    },
    {
      id: 'structure-data',
      name: 'Structure & Validate',
      skill: 'data-extract',
      input: {
        data: '{{paginateExtract.allData}}',
        format: 'json',
        schema: {
          type: 'array',
          items: '{{userSchema || "auto-detect"}}',
        },
      },
      dependsOn: ['paginate-extract'],
      outputMap: {
        structureData: {
          structuredData: 'finalData',
        },
      },
    },
    {
      id: 'export-data',
      name: 'Export Results',
      skill: 'agent-start',
      input: {
        task: 'Format the structured data as {{format || "CSV"}} and provide download instructions. Summary: {{structureData.structuredData.length}} records extracted.',
      },
      dependsOn: ['structure-data'],
      outputMap: {
        exportData: {
          export: 'exportResult',
        },
      },
    },
  ],
  metadata: {
    category: 'data',
    tags: ['extraction', 'scraping', 'pagination', 'export'],
    requiredParams: ['url'],
    optionalParams: ['maxPages', 'format', 'userSchema'],
    estimatedDuration: '5-15 minutes',
  },
};