/**
 * Context Parser - Extracts structured context from window titles
 * 
 * Parses application window titles to identify:
 * - Project names (e.g., from VS Code)
 * - Domains/URLs (e.g., from browsers)
 * - Activity types (e.g., Coding, Research, Media)
 */

export interface ActivityContext {
    /** The raw application name */
    app: string;
    /** Parsed project name (if applicable, e.g., from VS Code) */
    project?: string;
    /** Active file name (if applicable) */
    file?: string;
    /** Domain (for browser apps) */
    domain?: string;
    /** High-level activity category inferred from context */
    activityType: 'coding' | 'research' | 'communication' | 'media' | 'productivity' | 'other';
}

// --- Parsing Rules ---

export interface ContextRule {
    /** App name pattern (case-insensitive substring match) */
    appPattern: string;
    /** Default activity type if matched */
    activityType?: ActivityContext['activityType'];
    /** Function to parse the window title for this app */
    parse?: (title: string, app: string) => Partial<ActivityContext>;
}

// VS Code window title format: "filename — project — Visual Studio Code"
// or "filename - project - Visual Studio Code"
// Updated to require spaces around separators to avoid matching hyphens in filenames
const VSCODE_TITLE_REGEX = /^(.+?)\s+[-—]\s+(.+?)\s+[-—]\s+(?:Visual Studio Code|Cursor)/i;
// For 'Code' app name on some platforms - matches "filename - project - Code"
const VSCODE_SHORT_TITLE_REGEX = /^(.+?)\s+[-—]\s+(.+?)\s+[-—]\s+(?:Visual Studio )?Code/i;

// Generic browser domain extraction from title (often "Page Title - Domain - Browser Name")
// This is a heuristic; not all titles follow this format
// Fixed regex to capture full domain
const BROWSER_DOMAIN_REGEX = /[-—]\s*([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)/;

// Domain categories for classification
const DOMAIN_CATEGORIES: Record<string, ActivityContext['activityType']> = {
    'github.com': 'coding',
    'gitlab.com': 'coding',
    'stackoverflow.com': 'research',
    'google.com': 'research',
    'bing.com': 'research',
    'docs.google.com': 'productivity',
    'notion.so': 'productivity',
    'youtube.com': 'media',
    'bilibili.com': 'media',
    'twitter.com': 'communication',
    'x.com': 'communication',
    'slack.com': 'communication',
    'discord.com': 'communication',
    'teams.microsoft.com': 'communication',
    'mail.google.com': 'communication',
    'outlook.live.com': 'communication',
};

const DEFAULT_RULES: ContextRule[] = [
    // Dynamic rule injection point (priority over defaults)
    // VS Code / Cursor / Similar Editors
    {
        appPattern: 'code',
        parse: (title) => {
            const match = title.match(VSCODE_TITLE_REGEX) || title.match(VSCODE_SHORT_TITLE_REGEX);
            if (match) {
                return {
                    file: match[1].trim(),
                    project: match[2].trim(),
                    activityType: 'coding'
                };
            }
            return { activityType: 'coding' };
        }
    },
    {
        appPattern: 'cursor',
        parse: (title) => {
            // Cursor uses similar format to VS Code
            const match = title.match(VSCODE_TITLE_REGEX);
            if (match) {
                return {
                    file: match[1].trim(),
                    project: match[2].trim(),
                    activityType: 'coding'
                };
            }
            return { activityType: 'coding' };
        }
    },
    // Browsers - Chrome, Edge, Firefox, etc.
    {
        appPattern: 'chrome',
        parse: (title) => parseBrowserTitle(title)
    },
    {
        appPattern: 'msedge',
        parse: (title) => parseBrowserTitle(title)
    },
    {
        appPattern: 'firefox',
        parse: (title) => parseBrowserTitle(title)
    },
    {
        appPattern: 'brave',
        parse: (title) => parseBrowserTitle(title)
    },
    {
        // Fallback for "Google Chrome" full name
        appPattern: 'google chrome',
        parse: (title) => parseBrowserTitle(title)
    },
    // Communication Apps
    { appPattern: 'slack', activityType: 'communication' },
    { appPattern: 'discord', activityType: 'communication' },
    { appPattern: 'teams', activityType: 'communication' },
    { appPattern: 'wechat', activityType: 'communication' },
    // Productivity Apps
    { appPattern: 'notion', activityType: 'productivity' },
    { appPattern: 'obsidian', activityType: 'productivity' },
    // Media Apps
    { appPattern: 'spotify', activityType: 'media' },
    { appPattern: 'vlc', activityType: 'media' }
];

// Active rules (can be updated dynamically)
let activeRules: ContextRule[] = [...DEFAULT_RULES];

/**
 * Update the context parsing rules dynamically.
 * Useful for loading from config/DB.
 */
export function setContextRules(rules: ContextRule[]) {
    // Prepend custom rules to defaults so they take precedence
    activeRules = [...rules, ...DEFAULT_RULES];
}

export function getContextRules(): ContextRule[] {
    return activeRules;
}

// Heuristic to extract the main domain from a subdomain string
// e.g., "docs.google.com" -> "google.com", "github.com" -> "github.com"
function getMainDomain(hostname: string): string {
    const parts = hostname.split('.');
    if (parts.length > 2) {
        // Very basic handling: take last two parts
        // This is not perfect (e.g. co.uk) but works for the hardcoded list above
        return parts.slice(-2).join('.');
    }
    return hostname;
}

function parseBrowserTitle(title: string): Partial<ActivityContext> {
    // Try to extract domain from title
    const domainMatch = title.match(BROWSER_DOMAIN_REGEX);
    if (domainMatch) {
        // The regex captures the full hostname (e.g. "github.com" or "docs.google.com")
        const fullDomain = domainMatch[1].toLowerCase();
        
        // Check exact match first
        let activityType = DOMAIN_CATEGORIES[fullDomain];
        
        // If no exact match, try checking the main domain
        if (!activityType) {
            const mainDomain = getMainDomain(fullDomain);
             activityType = DOMAIN_CATEGORIES[mainDomain];
        }
        
        return { domain: fullDomain, activityType: activityType || 'research' };
    }
    // Default browser activity
    return { activityType: 'research' };
}

/**
 * Parses a window's app name and title into a structured ActivityContext.
 * @param app The application name (e.g., "Code", "chrome")
 * @param title The window title
 * @returns Structured activity context
 */
export function parseWindowContext(app: string, title: string): ActivityContext {
    const appLower = app.toLowerCase();

    // Find matching parser rule
    for (const rule of activeRules) {
        if (appLower.includes(rule.appPattern.toLowerCase())) {
            let parsed: Partial<ActivityContext> = {};
            
            if (rule.parse) {
                parsed = rule.parse(title, app);
            } 
            
            // Apply default activity type if not returned by parse
            if (!parsed.activityType && rule.activityType) {
                parsed.activityType = rule.activityType;
            }

            return {
                app,
                activityType: parsed.activityType || 'other',
                ...parsed
            };
        }
    }

    // Default fallback
    return {
        app,
        activityType: 'other'
    };
}

/**
 * Determines if two contexts represent significantly different activities.
 * Used to decide when to create a new batch.
 * @returns true if contexts are different enough to warrant a new segment
 */
export function isContextChange(prev: ActivityContext | null, current: ActivityContext): boolean {
    if (!prev) return true;

    // Different app is always a change
    if (prev.app.toLowerCase() !== current.app.toLowerCase()) {
        return true;
    }

    // Same app but different project (including undefined transitions)
    // e.g., "ShuTong" -> undefined (welcome screen) should be a change
    if (prev.project !== current.project) {
        return true;
    }

    // Same browser but different domain (including undefined transitions)
    if (prev.domain !== current.domain) {
        return true;
    }

    return false;
}

/**
 * Creates a human-readable label for an activity context.
 * Used for timeline card titles.
 */
export function getContextLabel(context: ActivityContext): string {
    if (context.project) {
        return `${context.app} - ${context.project}`;
    }
    if (context.domain) {
        return `${context.app} - ${context.domain}`;
    }
    return context.app;
}
