import { ActivityContext } from './context-parser';

export const BASE_SYSTEM_PROMPT = `
Analyze this sequence of screenshots from a user's computer. 
Describe what the user is doing in a chronological list of observations.
For each observation, provide the approximate start and end index (0-based) of the screenshots that match this activity.
`.trim();

export const JSON_FORMAT_INSTRUCTION = `
Return JSON format:
{
  "observations": [
    { "start_index": 0, "end_index": 2, "text": "User is editing code in VS Code" }
  ]
}
`.trim();

export const SCENARIO_PROMPTS: Record<string, string> = {
    'coding': `
Focus on the code being written, debugging steps, and file navigation.
Identify the programming language, libraries used, and the specific feature or bug being worked on.
Note any terminal commands or error messages visible.
`.trim(),

    'research': `
Focus on the information being gathered. 
Identify the search queries, documentation pages, and specific concepts being researched.
Summarize the key information visible on the screen.
`.trim(),

    'communication': `
Focus on the interaction context.
Identify the platform (Slack, Discord, Email), the participants (if visible and public), and the topic of discussion.
Summarize the intent of the message being composed or read.
`.trim(),

    'media': `
Focus on the media content being consumed or created.
Identify the platform (YouTube, Spotify, etc.), the title of the video/song, and the user's interaction (watching, editing, organizing).
`.trim(),

    'productivity': `
Focus on the task management or document creation.
Identify the tool (Notion, Obsidian, Google Docs), the structure of the document, and the specific items being organized.
`.trim(),

    'other': `
Focus on the general application usage and user flow.
`.trim()
};

export function getPromptForContext(context?: ActivityContext): string {
    if (!context) {
        return `${BASE_SYSTEM_PROMPT}\n\n${JSON_FORMAT_INSTRUCTION}`;
    }

    const scenarioPrompt = SCENARIO_PROMPTS[context.activityType] || SCENARIO_PROMPTS['other'];
    const contextInfo = `
Current App: ${context.app}
${context.project ? `Project: ${context.project}` : ''}
${context.domain ? `Domain: ${context.domain}` : ''}
${context.file ? `File: ${context.file}` : ''}
`.trim();

    return `
${BASE_SYSTEM_PROMPT}

Context Information:
${contextInfo}

Scenario Instructions (${context.activityType}):
${scenarioPrompt}

${JSON_FORMAT_INSTRUCTION}
`.trim();
}
