import { app } from 'electron';
import { ZH_CN_PROMPTS } from './zh-CN';
import { EN_US_PROMPTS } from './en-US';
import { PromptTemplates } from './templates';

export * from './templates';

export function getPromptTemplates(locale?: string): PromptTemplates {
    // In tests, app might be undefined or mocked differently
    const currentLocale = locale || (app ? app.getLocale() : 'en-US');
    if (currentLocale && currentLocale.startsWith('zh')) {
        return ZH_CN_PROMPTS;
    }
    return EN_US_PROMPTS;
}

export function getAnalysisSystemPrompt(contextInfo?: string, locale?: string): string {
    const templates = getPromptTemplates(locale);
    let prompt = templates.screenshot_analyze;
    
    if (contextInfo) {
        prompt += `\n\nContext Information:\n${contextInfo}`;
    }
    
    return prompt;
}
