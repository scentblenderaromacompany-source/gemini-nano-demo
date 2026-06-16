// GitHub PR Review Workflow Template
// Fetches PR, analyzes changed files, posts review comments

export const githubPrReviewWorkflow = {
  id: 'github-pr-review',
  name: 'GitHub PR Review',
  description: 'Automated code review for GitHub PRs with inline comments',
  version: '1.0',
  steps: [
    {
      id: 'fetch-pr',
      name: 'Fetch PR Details',
      skill: 'agent-start',
      input: {
        task: 'Go to github.com/{{repo}}/pull/{{prNumber}} and extract: PR title, description, author, base/compare branches, and list of changed files with diff stats',
      },
      dependsOn: [],
      outputMap: {
        fetchPr: {
          prTitle: 'prTitle',
          prDescription: 'prDescription',
          changedFiles: 'changedFiles',
        },
      },
    },
    {
      id: 'analyze-changes',
      name: 'Analyze Code Changes',
      skill: 'code-review',
      input: {
        code: '{{fetchPr.changedFiles}}',
        context: 'PR: {{fetchPr.prTitle}}\nDescription: {{fetchPr.prDescription}}',
      },
      dependsOn: ['fetch-pr'],
      outputMap: {
        analyzeChanges: {
          review: 'reviewOutput',
          issues: 'issuesFound',
        },
      },
    },
    {
      id: 'security-check',
      name: 'Security Audit',
      skill: 'security-check',
      input: {
        code: '{{fetchPr.changedFiles}}',
        focus: 'new code in PR',
      },
      dependsOn: ['fetch-pr'],
      outputMap: {
        securityCheck: {
          vulnerabilities: 'securityIssues',
        },
      },
    },
    {
      id: 'generate-tests',
      name: 'Generate Test Suggestions',
      skill: 'code-test',
      input: {
        code: '{{fetchPr.changedFiles}}',
        framework: 'auto-detect',
      },
      dependsOn: ['fetch-pr', 'analyze-changes'],
      outputMap: {
        generateTests: {
          testSuggestions: 'testIdeas',
        },
      },
    },
    {
      id: 'post-review',
      name: 'Post Review Comments',
      skill: 'agent-start',
      input: {
        task: 'Go to github.com/{{repo}}/pull/{{prNumber}}/files and post review comments based on analysis:\n{{analyzeChanges.review}}\n\nSecurity issues: {{securityCheck.vulnerabilities}}\n\nTest suggestions: {{generateTests.testSuggestions}}',
      },
      dependsOn: ['analyze-changes', 'security-check', 'generate-tests'],
    },
  ],
  metadata: {
    category: 'development',
    tags: ['github', 'code-review', 'automation'],
    requiredParams: ['repo', 'prNumber'],
    estimatedDuration: '2-5 minutes',
  },
};