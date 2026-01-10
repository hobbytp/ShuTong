/**
 * ActivityCategorizer
 * 
 * Heuristic-based categorization for applications.
 * Phase 1: Hardcoded keywords.
 * Phase 2+: AI/User-defined rules.
 */

export type ProductivityCategory = 'productive' | 'neutral' | 'distraction';

export class ActivityCategorizer {
    private static PRODUCTIVE_KEYWORDS = [
        'VS Code', 'Visual Studio Code', 'vscode', 'Cursor', 'Windsurf', 'Notion', 'Obsidian',
        'Figma', 'Terminal', 'PowerShell', 'Command Prompt',
        'IntelliJ', 'PyCharm', 'Sublime', 'Vim', 'Git'
    ];

    private static DISTRACTION_KEYWORDS = [
        'YouTube', 'Bilibili', 'Steam', 'Discord', 'WeChat',
        'Telegram', 'Netflix', 'Twitter', 'X.com', 'Facebook',
        'Instagram', 'TikTok'
    ];


    private static DEV_KEYWORDS = ['VS Code', 'Visual Studio Code', 'vscode', 'Cursor', 'Windsurf', 'Terminal', 'PowerShell', 'Command Prompt', 'IntelliJ', 'PyCharm', 'Sublime', 'Vim', 'Git', 'localhost', '127.0.0.1'];
    private static DESIGN_KEYWORDS = ['Figma', 'Photoshop', 'Illustrator', 'Canva'];
    private static WRITING_KEYWORDS = ['Notion', 'Obsidian', 'Word'];

    /**
     * Categorize an app name into a productivity category.
     * Case-insensitive partial matching.
     */
    static categorize(appName: string): ProductivityCategory {
        if (!appName) return 'neutral';

        const lowerName = appName.toLowerCase();

        // Check Productive
        if (this.PRODUCTIVE_KEYWORDS.some(k => lowerName.includes(k.toLowerCase()))) {
            return 'productive';
        }

        // Check Distraction
        if (this.DISTRACTION_KEYWORDS.some(k => lowerName.includes(k.toLowerCase()))) {
            return 'distraction';
        }

        // Browsers/Comms defaults to neutral (unless specific site rules added later)
        // Note: Browsers are listed in NEUTRAL_KEYWORDS but logic falls through to 'neutral' anyway.
        // Keeping the list for explicit documentation or future refinement.

        return 'neutral';
    }

    /**
     * Get the logical group for an app (e.g., 'dev', 'design').
     * Used for determining if a context switch is "productive" (within same workflow).
     */
    static getAppGroup(appName: string): string | null {
        if (!appName) return null;
        const lowerName = appName.toLowerCase();

        if (this.DEV_KEYWORDS.some(k => lowerName.includes(k.toLowerCase()))) return 'dev';
        if (this.DESIGN_KEYWORDS.some(k => lowerName.includes(k.toLowerCase()))) return 'design';
        if (this.WRITING_KEYWORDS.some(k => lowerName.includes(k.toLowerCase()))) return 'writing';

        return null;
    }
}
