import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export class PromptManager {
    private prompts: any = {};
    private promptConfigPath: string;

    constructor(configPath?: string) {
        // Default to prompt_zh.yaml in the same directory
        const defaultPath = path.resolve(__dirname, 'prompt_zh.yaml');
        this.promptConfigPath = configPath || defaultPath;

        this.loadPrompts();
    }

    private loadPrompts() {
        try {
            if (fs.existsSync(this.promptConfigPath)) {
                const fileContents = fs.readFileSync(this.promptConfigPath, 'utf8');
                this.prompts = yaml.load(fileContents) || {};
                console.log(`Loaded prompts from ${this.promptConfigPath}`);
            } else {
                console.warn(`Prompt config file not found at ${this.promptConfigPath}. Using empty prompts.`);
            }
        } catch (e) {
            console.error(`Failed to load prompts: ${e}`);
        }
    }

    public getPrompt(name: string, context: Record<string, any> = {}, defaultVal: string = ''): string {
        const keys = name.split('.');
        let value = this.prompts;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                console.warn(`Prompt '${name}' not found.`);
                return defaultVal;
            }
        }

        if (typeof value === 'string') {
            return this.formatPrompt(value, context);
        }

        return defaultVal;
    }

    public getRawPrompt(name: string, defaultVal: any = null): any {
        const keys = name.split('.');
        let value = this.prompts;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defaultVal;
            }
        }

        return value;
    }

    private formatPrompt(template: string, context: Record<string, any>): string {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return key in context ? String(context[key]) : match;
        });
    }
}

// Singleton instance
let promptManagerInstance: PromptManager | null = null;

/**
 * Get the singleton PromptManager instance
 */
export function getPromptManager(): PromptManager {
    if (!promptManagerInstance) {
        promptManagerInstance = new PromptManager();
    }
    return promptManagerInstance;
}
