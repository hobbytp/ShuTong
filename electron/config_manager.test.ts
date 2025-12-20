import { describe, expect, it } from 'vitest';
import { validateLLMConfig } from './config_manager';

describe('LLM Config Validation', () => {
    it('should validate a correct configuration', () => {
        const validConfig = {
            providers: {
                openai: {
                    apiBaseUrl: 'https://api.openai.com/v1',
                    apiKeyEnv: 'OPENAI_API_KEY',
                    openaiCompatible: true,
                    models: {
                        'gpt-4o': {
                            displayName: 'GPT-4o',
                            contextWindow: 128000,
                            maxOutputTokens: 4096,
                            supportsFunctionCalling: true,
                            supportsVision: true
                        }
                    }
                }
            },
            roleConfigs: {
                summarizer: {
                    provider: 'openai',
                    model: 'gpt-4o',
                    temperature: 0.7,
                    description: 'Summarizes text'
                }
            }
        };
        const result = validateLLMConfig(JSON.stringify(validConfig));
        expect(result.success).toBe(true);
    });

    it('should fail on invalid JSON syntax', () => {
        const invalidJson = '{ providers: { ... } ';
        const result = validateLLMConfig(invalidJson);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Unexpected token');
    });

    it('should fail on missing required fields in provider', () => {
        const invalidConfig = {
            providers: {
                openai: {
                    // apiBaseUrl missing
                    apiKeyEnv: 'OPENAI_API_KEY',
                    openaiCompatible: true,
                    models: {}
                }
            },
            roleConfigs: {}
        };
        const result = validateLLMConfig(JSON.stringify(invalidConfig));
        expect(result.success).toBe(false);
        expect(result.error).toContain('apiBaseUrl');
    });

    it('should fail if contextWindow is not a number', () => {
        const invalidConfig = {
            providers: {
                openai: {
                    apiBaseUrl: 'url',
                    apiKeyEnv: 'KEY',
                    openaiCompatible: true,
                    models: {
                        'm1': {
                            displayName: 'M1',
                            contextWindow: '128000', // string instead of number
                            maxOutputTokens: 4096,
                            supportsFunctionCalling: true,
                            supportsVision: true
                        }
                    }
                }
            },
            roleConfigs: {}
        };
        const result = validateLLMConfig(JSON.stringify(invalidConfig));
        expect(result.success).toBe(false);
        expect(result.error).toContain('number');
    });

    it('should fail if role refers to non-existent provider', () => {
        const invalidConfig = {
            providers: {
                openai: {
                    apiBaseUrl: 'url',
                    apiKeyEnv: 'KEY',
                    openaiCompatible: true,
                    models: { 'm1': { displayName: 'M1', contextWindow: 0, maxOutputTokens: 0, supportsFunctionCalling: true, supportsVision: true } }
                }
            },
            roleConfigs: {
                r1: {
                    provider: 'anthropic', // provider does not exist
                    model: 'm1',
                    temperature: 0.5,
                    description: 'desc'
                }
            }
        };
        const result = validateLLMConfig(JSON.stringify(invalidConfig));
        expect(result.success).toBe(false);
        expect(result.error).toContain('provider "anthropic" does not exist');
    });
});
