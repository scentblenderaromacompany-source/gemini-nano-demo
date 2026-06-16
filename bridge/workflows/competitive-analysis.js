// Competitive Analysis Workflow Template
// Competitors -> features -> pricing -> comparison matrix

export const competitiveAnalysisWorkflow = {
  id: 'competitive-analysis',
  name: 'Competitive Analysis',
  description: 'Automated competitive intelligence: features, pricing, positioning',
  version: '1.0',
  steps: [
    {
      id: 'identify-competitors',
      name: 'Identify Competitors',
      skill: 'agent-start',
      input: {
        task: 'For "{{productOrCategory}}", find top 10 competitors. Search for: "{{productOrCategory}} alternatives", "{{productOrCategory}} competitors", "{{productOrCategory}} vs". Return list with company names, URLs, and brief descriptions.',
      },
      dependsOn: [],
      outputMap: {
        identifyCompetitors: {
          competitors: 'competitorList',
        },
      },
    },
    {
      id: 'extract-features',
      name: 'Extract Features',
      skill: 'agent-start',
      input: {
        task: 'For each competitor in {{identifyCompetitors.competitors}}, visit their website and extract: key features, integrations, tech stack, target audience, and unique selling points. Return structured data.',
      },
      dependsOn: ['identify-competitors'],
      outputMap: {
        extractFeatures: {
          featuresData: 'featuresMatrix',
        },
      },
    },
    {
      id: 'extract-pricing',
      name: 'Extract Pricing',
      skill: 'data-extract',
      input: {
        task: 'Extract pricing for each competitor in {{identifyCompetitors.competitors}}. Find: pricing tiers, features per tier, free trial, enterprise pricing, discounts. Return comparison table.',
      },
      dependsOn: ['identify-competitors'],
      outputMap: {
        extractPricing: {
          pricingData: 'pricingMatrix',
        },
      },
    },
    {
      id: 'analyze-positioning',
      name: 'Analyze Positioning',
      skill: 'compare',
      input: {
        subjectA: '{{productOrCategory}}',
        subjectB: 'top 3 competitors from {{extractFeatures.featuresMatrix}}',
        criteria: 'features, pricing, target market, integrations, ease of use, support',
      },
      dependsOn: ['extract-features', 'extract-pricing'],
      outputMap: {
        analyzePositioning: {
          comparison: 'positioningAnalysis',
        },
      },
    },
    {
      id: 'generate-report',
      name: 'Generate Competitive Report',
      skill: 'write-blog',
      input: {
        topic: 'Competitive Analysis: {{productOrCategory}}',
        outline: {
          executiveSummary: '2-paragraph summary',
          marketLandscape: '{{identifyCompetitors.competitors.length}} competitors identified',
          featureComparison: '{{extractFeatures.featuresMatrix}}',
          pricingComparison: '{{extractPricing.pricingMatrix}}',
          positioning: '{{analyzePositioning.comparison}}',
          recommendations: 'Strategic recommendations based on gaps',
        },
        style: 'professional competitive intelligence report',
      },
      dependsOn: ['analyze-positioning'],
      outputMap: {
        generateReport: {
          report: 'finalReport',
        },
      },
    },
  ],
  metadata: {
    category: 'business',
    tags: ['competitive-analysis', 'market-research', 'pricing', 'strategy'],
    requiredParams: ['productOrCategory'],
    estimatedDuration: '5-12 minutes',
  },
};