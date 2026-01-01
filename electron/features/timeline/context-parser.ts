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

interface ParserRule {
    /** App name pattern (case-insensitive substring match) */
    appPattern: string;
    /** Function to parse the window title for this app */
    parse: (title: string, app: string) => Partial<ActivityContext>;
}

// VS Code window title format: "filename — project — Visual Studio Code"
// or "filename - project - Visual Studio Code"
const VSCODE_TITLE_REGEX = /^(.+?)\s*[-—]\s*(.+?)\s*[-—]\s*Visual Studio Code/i;

// Generic browser domain extraction from title (often "Page Title - Domain - Browser Name")
// This is a heuristic; not all titles follow this format
const BROWSER_DOMAIN_REGEX = /[-—]\s*([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)\s*[-—]/;

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

const PARSER_RULES: ParserRule[] = [
    // VS Code / Cursor / Similar Editors
    {
        appPattern: 'code',
        parse: (title) => {
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
    // Communication Apps
    {
        appPattern: 'slack',
        parse: () => ({ activityType: 'communication' as const })
    },
    {
        appPattern: 'discord',
        parse: () => ({ activityType: 'communication' as const })
    },
    {
        appPattern: 'teams',
        parse: () => ({ activityType: 'communication' as const })
    },
    {
        appPattern: 'wechat',
        parse: () => ({ activityType: 'communication' as const })
    },
    // Productivity Apps
    {
        appPattern: 'notion',
        parse: () => ({ activityType: 'productivity' as const })
    },
    {
        appPattern: 'obsidian',
        parse: () => ({ activityType: 'productivity' as const })
    },
    // Media Apps
    {
        appPattern: 'spotify',
        parse: () => ({ activityType: 'media' as const })
    },
    {
        appPattern: 'vlc',
        parse: () => ({ activityType: 'media' as const })
    }
];

function parseBrowserTitle(title: string): Partial<ActivityContext> {
    // Try to extract domain from title
    const domainMatch = title.match(BROWSER_DOMAIN_REGEX);
    if (domainMatch) {
        const domain = domainMatch[1].toLowerCase();
        const activityType = DOMAIN_CATEGORIES[domain] || 'research';
        return { domain, activityType };
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
    for (const rule of PARSER_RULES) {
        if (appLower.includes(rule.appPattern)) {
            const parsed = rule.parse(title, app);
            return {
                app,
                activityType: 'other', // Default, overridden by parsed result
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
