
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { getSettings, setSetting } from './storage';

// --- Types ---

export interface ModelPricing {
    inputTokensPrice: number;
    outputTokensPrice: number;
    currency: string;
    per: number;
}

export interface ModelConfig {
    displayName: string;
    contextWindow: number;
    maxOutputTokens: number;
    supportsFunctionCalling: boolean;
    supportsVision: boolean;
    pricing?: ModelPricing;
    [key: string]: any;
}

export interface ProviderConfig {
    docUrl?: string;
    apiBaseUrl: string;
    apiKeyEnv: string;
    openaiCompatible: boolean;
    timeout?: number; // Request timeout in ms (default: 60000)
    firstTokenTimeout?: number; // Timeout for first token in streaming (default: 30000)
    maxScreenshotsPerRequest?: number; // Max images per prompt (default: 15)
    chunkDelayMs?: number; // Delay between chunks in ms (default: 1000)
    streamIdleTimeout?: number; // Idle timeout for streaming in ms (default: 30000)
    models: Record<string, ModelConfig>;
    [key: string]: any;
}

export interface RoleConfig {
    provider: string;
    model: string;
    temperature: number;
    description: string;
}

export interface LLMGlobalConfig {
    providers: Record<string, ProviderConfig>;
    roleConfigs: Record<string, RoleConfig>;
    adaptiveChunking?: AdaptiveChunkingConfig;
    graphStore?: GraphStoreConfig;
}

export interface AdaptiveChunkingConfig {
    enabled: boolean;
    minSize: number;             // Minimum chunk size (default: 2)
    maxSize: number;             // Maximum chunk size (default: 15)
    slowSecsPerShot: number;     // Threshold for slow performance (default: 8s)
    fastSecsPerShot: number;     // Threshold for fast performance (default: 2s)
    hysteresisCount: number;     // Consecutive readings before adjustment (default: 3)
    cooldownRequests: number;    // Requests to wait after adjustment (default: 5)
}

export interface GraphStoreConfig {
    enabled: boolean;
    url?: string;
    username?: string;
    password?: string;
    customPrompt?: string; // For EXTRACT_RELATIONS_PROMPT customization
}

export interface RuntimeProviderConfig extends ProviderConfig {
    hasKey: boolean;
    apiKey?: string; // Only populated if set by user override
}

// --- Implementation ---

const CONFIG_FILENAME = 'llm_config.json';

function getConfigFile(): LLMGlobalConfig {
    // Try app root (dev) and resources (prod)
    const possiblePaths = [
        path.join(app.getAppPath(), CONFIG_FILENAME),
        path.join(process.cwd(), CONFIG_FILENAME),
        path.join(app.getAppPath(), '..', CONFIG_FILENAME) // Common in some builds
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            try {
                return JSON.parse(fs.readFileSync(p, 'utf-8'));
            } catch (e) {
                console.error(`[ConfigManager] Failed to parse ${p}:`, e);
            }
        }
    }

    console.error(`[ConfigManager] Could not find ${CONFIG_FILENAME}`);
    return { providers: {}, roleConfigs: {} };
}

export function getMergedLLMConfig() {
    const defaults = getConfigFile();
    const settings = getSettings();

    // Merge Providers
    const mergedProviders: Record<string, RuntimeProviderConfig> = {};

    if (defaults.providers) {
        for (const [name, provider] of Object.entries(defaults.providers)) {
            const settingKeyBase = `llm.provider.${name}`;
            const userBaseUrl = settings[`${settingKeyBase}.baseUrl`];
            const userApiKey = settings[`${settingKeyBase}.apiKey`];
            // @ts-ignore
            const envKey = process.env[provider.apiKeyEnv];

            mergedProviders[name] = {
                ...provider,
                apiBaseUrl: userBaseUrl || provider.apiBaseUrl,
                hasKey: !!(userApiKey || envKey),
                apiKey: userApiKey || '' // Only return user-set key
            };
        }
    }

    // Merge Roles
    const mergedRoles: Record<string, RoleConfig> = {};
    const roleKeys = new Set<string>();

    // 1. Add keys from defaults
    if (defaults.roleConfigs) {
        Object.keys(defaults.roleConfigs).forEach(k => roleKeys.add(k));
    }

    // 2. Add keys from settings (format: llm.role.<ROLE>.provider)
    Object.keys(settings).forEach(key => {
        if (key.startsWith('llm.role.') && key.endsWith('.provider')) {
            const parts = key.split('.');
            if (parts.length === 4) {
                roleKeys.add(parts[2]);
            }
        }
    });

    for (const role of roleKeys) {
        const config = defaults.roleConfigs?.[role] || {
            provider: 'OpenAI',
            model: 'gpt-4o',
            temperature: 0.5,
            description: 'Custom Role'
        }; // Fallback for pure-DB roles

        const settingKeyBase = `llm.role.${role}`;
        mergedRoles[role] = {
            ...config,
            provider: settings[`${settingKeyBase}.provider`] || config.provider,
            model: settings[`${settingKeyBase}.model`] || config.model,
            temperature: settings[`${settingKeyBase}.temperature`] ? parseFloat(settings[`${settingKeyBase}.temperature`]) : config.temperature
        };
    }

    return {
        providers: mergedProviders,
        roleConfigs: mergedRoles,
        adaptiveChunking: defaults.adaptiveChunking,
        graphStore: defaults.graphStore || { enabled: false }
    };
}

/**
 * Get config for Main process (includes secrets from Env)
 */
export function getLLMConfigForMain() {
    const defaults = getConfigFile();
    const settings = getSettings();

    const mergedProviders: Record<string, RuntimeProviderConfig> = {};

    if (defaults.providers) {
        for (const [name, provider] of Object.entries(defaults.providers)) {
            const settingKeyBase = `llm.provider.${name}`;
            const userBaseUrl = settings[`${settingKeyBase}.baseUrl`];
            const userApiKey = settings[`${settingKeyBase}.apiKey`];
            // @ts-ignore
            const envKey = process.env[provider.apiKeyEnv];

            mergedProviders[name] = {
                ...provider,
                apiBaseUrl: userBaseUrl || provider.apiBaseUrl,
                hasKey: !!(userApiKey || envKey),
                apiKey: userApiKey || envKey || '' // Include Env Key for Backend
            };
        }
    }

    // Merge Roles (Same as frontend)
    const mergedRoles: Record<string, RoleConfig> = {};
    const roleKeys = new Set<string>();

    // 1. Add keys from defaults
    if (defaults.roleConfigs) {
        Object.keys(defaults.roleConfigs).forEach(k => roleKeys.add(k));
    }

    // 2. Add keys from settings
    Object.keys(settings).forEach(key => {
        if (key.startsWith('llm.role.') && key.endsWith('.provider')) {
            const parts = key.split('.');
            if (parts.length === 4) {
                roleKeys.add(parts[2]);
            }
        }
    });

    for (const role of roleKeys) {
        const config = defaults.roleConfigs?.[role] || {
            provider: 'OpenAI',
            model: 'gpt-4o',
            temperature: 0.5,
            description: 'Custom Role'
        };

        const settingKeyBase = `llm.role.${role}`;
        mergedRoles[role] = {
            ...config,
            provider: settings[`${settingKeyBase}.provider`] || config.provider,
            model: settings[`${settingKeyBase}.model`] || config.model,
            temperature: settings[`${settingKeyBase}.temperature`] ? parseFloat(settings[`${settingKeyBase}.temperature`]) : config.temperature
        };
    }

    return {
        providers: mergedProviders,
        roleConfigs: mergedRoles,
        adaptiveChunking: defaults.adaptiveChunking,
        graphStore: defaults.graphStore || { enabled: false }
    };
}

export function setLLMProviderConfig(providerName: string, config: { baseUrl?: string, apiKey?: string }) {
    if (config.baseUrl !== undefined) {
        setSetting(`llm.provider.${providerName}.baseUrl`, config.baseUrl);
    }
    if (config.apiKey !== undefined) {
        setSetting(`llm.provider.${providerName}.apiKey`, config.apiKey);
    }
}

export function setRoleConfig(roleName: string, config: { provider?: string, model?: string, temperature?: number }) {
    if (config.provider) setSetting(`llm.role.${roleName}.provider`, config.provider);
    if (config.model) setSetting(`llm.role.${roleName}.model`, config.model);
    if (config.temperature !== undefined) setSetting(`llm.role.${roleName}.temperature`, config.temperature.toString());
}

// --- Raw Config I/O ---

function getConfigPath(): string | null {
    const possiblePaths = [
        path.join(process.cwd(), CONFIG_FILENAME),
        path.join(app.getAppPath(), CONFIG_FILENAME),
        path.join(app.getAppPath(), '..', CONFIG_FILENAME)
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

export function getRawLLMConfig(): { content: string, path: string } {
    const p = getConfigPath();
    if (p) {
        return { content: fs.readFileSync(p, 'utf-8'), path: p };
    }
    return { content: '{}', path: '' };
}

// --- Validation Schemas ---

const ModelPricingSchema = z
    .object({
        inputTokensPrice: z.number(),
        outputTokensPrice: z.number(),
        currency: z.string(),
        per: z.number()
    })
    .passthrough();

const ModelConfigSchema = z
    .object({
        displayName: z.string(),
        contextWindow: z.number(),
        maxOutputTokens: z.number(),
        supportsFunctionCalling: z.boolean(),
        supportsVision: z.boolean(),
        pricing: ModelPricingSchema.optional()
    })
    .passthrough();

const ProviderConfigSchema = z
    .object({
        docUrl: z.string().optional(),
        apiBaseUrl: z.string(),
        apiKeyEnv: z.string(),
        openaiCompatible: z.boolean(),
        timeout: z.number().optional(),
        firstTokenTimeout: z.number().optional(),
        maxScreenshotsPerRequest: z.number().optional(),
        chunkDelayMs: z.number().optional(),
        streamIdleTimeout: z.number().optional(),
        models: z.record(z.string(), ModelConfigSchema)
    })
    .passthrough();

const RoleConfigSchema = z.object({
    provider: z.string(),
    model: z.string(),
    temperature: z.number(),
    description: z.string()
});

const AdaptiveChunkingConfigSchema = z.object({
    enabled: z.boolean(),
    minSize: z.number().optional(),
    maxSize: z.number().optional(),
    slowSecsPerShot: z.number().optional(),
    fastSecsPerShot: z.number().optional(),
    hysteresisCount: z.number().optional(),
    cooldownRequests: z.number().optional()
});

const GraphStoreConfigSchema = z.object({
    enabled: z.boolean(),
    url: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    customPrompt: z.string().optional()
});

const LLMGlobalConfigSchema = z.object({
    providers: z.record(z.string(), ProviderConfigSchema),
    roleConfigs: z.record(z.string(), RoleConfigSchema),
    adaptiveChunking: AdaptiveChunkingConfigSchema.optional(),
    graphStore: GraphStoreConfigSchema.optional()
});

export function validateLLMConfig(content: string): { success: boolean, error?: string, data?: LLMGlobalConfig } {
    try {
        const json = JSON.parse(content);
        const result = LLMGlobalConfigSchema.safeParse(json);

        if (!result.success) {
            // Format Zod errors into a readable string
            const errorMsg = result.error.issues.map(iss => `${iss.path.join('.')}: ${iss.message}`).join('; ');
            return { success: false, error: errorMsg };
        }

        const data = result.data as LLMGlobalConfig;

        // Logical Check: Ensure roles point to existing providers
        for (const [_roleName, role] of Object.entries(data.roleConfigs)) {
            if (!data.providers[role.provider]) {
                return { success: false, error: `provider "${role.provider}" does not exist` };
            }
        }

        return { success: true, data };
    } catch (e: any) {
        if (e instanceof SyntaxError) {
            // Normalize parse errors across Node/V8 versions for stable UX + tests
            return { success: false, error: `Unexpected token: ${e.message}` };
        }
        return { success: false, error: e?.message ?? String(e) };
    }
}

export function saveRawLLMConfig(content: string): { success: boolean, error?: string } {
    const validation = validateLLMConfig(content);
    if (!validation.success) {
        return { success: false, error: validation.error };
    }

    try {
        // Determine save path: prefer existing, else userData
        let p = getConfigPath();
        if (!p) {
            p = path.join(app.getPath('userData'), CONFIG_FILENAME);
        }

        fs.writeFileSync(p, content, 'utf-8');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
