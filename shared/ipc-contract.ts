/**
 * Type-Safe IPC Contract
 * 
 * This file defines all IPC channels used between Main and Renderer processes.
 * Both sides import this contract to ensure type safety at compile time.
 * 
 * Usage:
 * - Main: import { IPCContract } from '@shared/ipc-contract'
 * - Renderer: import { invoke } from '@/lib/ipc'
 */

// =============================================================================
// Common Types (shared between Main and Renderer)
// =============================================================================

export interface Settings {
    [key: string]: string;
}

export interface Snapshot {
    id: number;
    file_path: string;
    captured_at: number;
}

export interface TimelineCard {
    id: number;
    batch_id: number | null;
    start_ts: number;
    end_ts: number;
    category: string;
    subcategory: string | null;
    title: string;
    summary: string;
    detailed_summary: string | null;
    video_url: string | null;
    created_at?: string;  // ISO timestamp string from DB
}

export interface CardDetails extends TimelineCard {
    screenshots?: { id: number; file_path: string; captured_at: number }[];
}

export interface PulseCard {
    id: string;
    type: string;
    title: string;
    content: string;
    suggested_actions: string[];
    created_at: number;
}

export interface JournalEntry {
    id?: number;
    content: string;
    type: 'intention' | 'reflection';
    created_at?: number;
}

export interface DashboardStats {
    totalSnapshots: number;
    todaySnapshots: number;
    storageUsed: string;
    lastCapture: string | null;
}

export interface ScreenInfo {
    id: number;
    name: string;
}

export interface LLMConfig {
    providers: Record<string, {
        apiBaseUrl: string;
        apiKeyEnv: string;
        models: Record<string, unknown>;
    }>;
    roleConfigs: Record<string, unknown>;
}

export interface DailySummary {
    date: string;
    totalActiveTime: number;
    topApps: { app: string; seconds: number }[];
    hourlyActivity: { hour: number; count: number }[];
}

export interface TimelineEvent {
    timestamp: number;
    type: 'switch' | 'skip' | 'capture';
    app?: string;
    title?: string;
    reason?: string;
}

export interface GuardStatistics {
    totalCaptures: number;
    totalSkips: number;
    skipsByReason: Record<string, number>;
}

export interface SkipLogEntry {
    timestamp: number;
    reason: string;
    app?: string;
    title?: string;
}

export interface CaptureEfficiency {
    captureRate: number;
    skipRate: number;
    dedupSaved: number;
}

// =============================================================================
// IPC Contract Definition
// =============================================================================

export interface IPCContract {
    // -------------------------------------------------------------------------
    // Window Controls
    // -------------------------------------------------------------------------
    'window-min': { args: []; return: void };
    'window-max': { args: []; return: void };
    'window-close': { args: []; return: void };

    // -------------------------------------------------------------------------
    // Capture
    // -------------------------------------------------------------------------
    'start-recording-sync': { args: []; return: void };
    'stop-recording-sync': { args: []; return: void };
    'get-recording-status': { args: []; return: { isRecording: boolean } };
    'get-available-screens': { args: []; return: ScreenInfo[] };

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------
    'get-settings': { args: []; return: Settings };
    'set-setting': { args: [key: string, value: string]; return: void };

    // -------------------------------------------------------------------------
    // Snapshots
    // -------------------------------------------------------------------------
    'get-snapshots': { args: [limit: number]; return: Snapshot[] };
    'get-snapshots-by-date': { args: [date: string]; return: Snapshot[] };

    // -------------------------------------------------------------------------
    // Timeline
    // -------------------------------------------------------------------------
    'get-timeline-cards': {
        args: [limit: number, offset: number, search?: string, category?: string];
        return: TimelineCard[];
    };
    'get-card-details': { args: [cardId: number]; return: CardDetails | null };
    'get-screenshots-for-card': {
        args: [cardId: number];
        return: { id: number; file_path: string; captured_at: number }[];
    };
    'export-timeline-markdown': {
        args: [date: string];
        return: { success: boolean; error?: string };
    };

    // -------------------------------------------------------------------------
    // Journal
    // -------------------------------------------------------------------------
    'get-journal-entries': { args: []; return: JournalEntry[] };
    'add-journal-entry': { args: [entry: Omit<JournalEntry, 'id' | 'created_at'>]; return: void };

    // -------------------------------------------------------------------------
    // Dashboard
    // -------------------------------------------------------------------------
    'get-dashboard-stats': { args: []; return: DashboardStats };

    // -------------------------------------------------------------------------
    // Pulse / AI Agent
    // -------------------------------------------------------------------------
    'get-pulse-cards': {
        args: [limit?: number];
        return: { success: boolean; cards: PulseCard[]; error?: string };
    };
    'generate-pulse-card': {
        args: [type: string];
        return: { success: boolean; card?: PulseCard; error?: string };
    };
    'ask-pulse': {
        args: [question: string];
        return: { success: boolean; response?: string; error?: string };
    };
    'search-semantic': {
        args: [query: string, limit?: number];
        return: { success: boolean; results: unknown[]; error?: string };
    };

    // -------------------------------------------------------------------------
    // Research Proposals
    // -------------------------------------------------------------------------
    'generate-research-proposal': {
        args: [];
        return: { success: boolean; card?: PulseCard; error?: string };
    };
    'dismiss-research-proposal': {
        args: [cardId: string];
        return: { success: boolean; error?: string };
    };
    'start-research-from-proposal': {
        args: [payload: { cardId: string; mode: 'auto' | 'fast' | 'deep' }];
        return: { success: boolean; deliverableCardIds?: string[]; error?: string };
    };
    'save-deliverable': {
        args: [cardId: string];
        return: { success: boolean; error?: string };
    };
    'discard-deliverable': {
        args: [cardId: string];
        return: { success: boolean; error?: string };
    };

    // -------------------------------------------------------------------------
    // LLM Configuration
    // -------------------------------------------------------------------------
    'get-llm-config': { args: []; return: LLMConfig };
    'set-llm-provider-config': {
        args: [providerName: string, config: { baseUrl?: string; apiKey?: string }];
        return: void;
    };
    'set-role-config': {
        args: [roleName: string, config: { provider?: string; model?: string; temperature?: number }];
        return: void;
    };
    'get-raw-llm-config': { args: []; return: { content: string; path: string } };
    'save-raw-llm-config': {
        args: [content: string];
        return: { success: boolean; error?: string };
    };
    'import-llm-config': {
        args: [];
        return: { success: boolean; content?: string; error?: string };
    };
    'export-llm-config': {
        args: [content: string];
        return: { success: boolean; error?: string };
    };
    'test-llm-connection': {
        args: [providerName: string, config: { apiKey: string; apiBaseUrl?: string }, modelName?: string];
        return: { success: boolean; message: string };
    };

    // -------------------------------------------------------------------------
    // Storage / System
    // -------------------------------------------------------------------------
    'trigger-cleanup': { args: [days: number]; return: number };
    'select-directory': { args: [isOnboarding?: boolean]; return: string | null };
    'open-data-folder': { args: []; return: string };
    'get-app-path': { args: [name: string]; return: string };

    // -------------------------------------------------------------------------
    // Analytics
    // -------------------------------------------------------------------------
    'analytics:getDailySummary': { args: [date: string]; return: DailySummary };
    'analytics:getTimeline': {
        args: [startTs: number, endTs: number, limit?: number];
        return: TimelineEvent[];
    };
    'analytics:getEfficiency': { args: []; return: CaptureEfficiency };
    'analytics:getTopApps': {
        args: [startTs: number, endTs: number, limit?: number];
        return: { app: string; seconds: number }[];
    };

    // -------------------------------------------------------------------------
    // Guard Statistics
    // -------------------------------------------------------------------------
    'guard:getStats': { args: []; return: GuardStatistics };
    'guard:getSkipLog': { args: [limit?: number]; return: SkipLogEntry[] };
    'guard:resetStats': { args: []; return: void };

    // -------------------------------------------------------------------------
    // Video
    // -------------------------------------------------------------------------
    'video:save': {
        args: [buffer: ArrayBuffer, filePath: string];
        return: { success: boolean };
    };
}

// =============================================================================
// Type Helpers
// =============================================================================

/** Extract channel names as a union type */
export type IPCChannel = keyof IPCContract;

/** Extract args type for a given channel */
export type IPCArgs<K extends IPCChannel> = IPCContract[K]['args'];

/** Extract return type for a given channel */
export type IPCReturn<K extends IPCChannel> = IPCContract[K]['return'];
