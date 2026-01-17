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

import { SproutSession, SproutMessage, SproutReport } from './sprout';

// =============================================================================
// Common Types (shared between Main and Renderer)
// =============================================================================

export interface Settings {
    [key: string]: string;
}

// Support both legacy snapshots table and new screenshots table
export interface Snapshot {
    id: number;
    file_path: string;
    timestamp?: string;      // Legacy format (ISO string)
    captured_at?: number;    // New format (Unix timestamp)
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

// Matches actual getDashboardStats() return
export interface DashboardStats {
    focusTime: string;           // e.g. "2h 30m"
    productivePercentage: number;
    lastActivity: string;
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

// Matches actual getDailyActivitySummary() return from analytics-service.ts
export interface DailySummary {
    date: string;                    // YYYY-MM-DD
    totalActiveSeconds: number;      // Total tracked time
    appUsage: { app: string; seconds: number; percentage: number }[];
    hourlyActivity: number[];        // 24 entries, seconds per hour
}

// Matches actual getActivityTimeline() return from analytics-service.ts
export interface TimelineEvent {
    timestamp: number;
    type: 'app_switch' | 'skip' | 'capture';
    app?: string;
    title?: string;
    from_app?: string;
    from_title?: string;
    reason?: string;
}

export interface GuardStatistics {
    totalCaptures: number;
    totalSkips: number;
    skipsByReason: Record<string, number>;
}

// Matches actual getSkipLog() return from capture-guard.ts
export interface SkipLogEntry {
    timestamp: number;
    reason: string | null;  // Can be null from capture-guard
    app?: string;
    title?: string;
}

// Matches actual getCaptureEfficiency() return from analytics-service.ts
export interface CaptureEfficiency {
    totalCaptures: number;
    totalSkips: number;
    efficiency: number;
    skipBreakdown: Record<string, number>;
}

// LLM Metrics types for observability
export type LLMErrorCategory = 'timeout' | 'rate_limit' | 'auth' | 'server_error' | 'network' | 'unknown';

export interface LLMMetricsSummary {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    errorsByCategory: Record<LLMErrorCategory, number>;
    averageDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    tokensPerSecond: number;
    lastUpdated: number;
}

// Matches actual getProductivitySummary() return from analytics.service.ts
export interface AppUsageStat {
    appName: string;
    duration: number;
    percentage: number;
    category: 'productive' | 'neutral' | 'distraction';
}

export interface CognitiveFlowPoint {
    timestamp: number; // unix timestamp in ms
    focusScore: number; // 0-100
    state: 'flow' | 'neutral' | 'distracted';
}

export interface ProductivitySummary {
    totalActiveMinutes: number;
    deepWorkMinutes: number;
    topApps: AppUsageStat[];
    focusScore: number;
    contextSwitches: number;
    recoveryTimeMinutes: number; // [NEW] Recommended recovery time
    cognitiveTrend: CognitiveFlowPoint[]; // [NEW] For the chart
}

// Phase 3: Drill Down Types
export interface AppDrillDownRequest {
    appName: string;
    startTs: number;
    endTs: number;
}

export interface DrillDownItem {
    windowTitle: string;
    duration: number; // minutes
    percentage: number;
}

export type AppDrillDownResponse = DrillDownItem[];

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
    'app:open-external': { args: [url: string]; return: { success: boolean } };

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
    'get-snapshots-by-filter': { args: [date: string, filter: any]; return: Snapshot[] };

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
    'get-productivity-summary': { args: [date: string]; return: ProductivitySummary };

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
        args: [payload?: { timeRange?: { start: number; end: number; label?: string } }];
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
    'reset-database': { args: []; return: { success: boolean; error?: string; stats?: { filesDeleted: number; tablesCleared: number } } };

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
    'get-app-drilldown': {
        args: [{ appName: string; startTs: number; endTs: number }];
        return: AppDrillDownResponse;
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

    // -------------------------------------------------------------------------
    // LLM Metrics
    // -------------------------------------------------------------------------
    'llm:getMetrics': {
        args: [];
        return: LLMMetricsSummary;
    };
    'llm:resetMetrics': {
        args: [];
        return: void;
    };

    // -------------------------------------------------------------------------
    // I18n
    // -------------------------------------------------------------------------
    'change-language': { args: [lang: string]; return: { success: boolean } };
    'get-language': { args: []; return: string };

    // -------------------------------------------------------------------------
    // Theme
    // -------------------------------------------------------------------------
    'change-theme': { args: [theme: string]; return: { success: boolean } };
    'get-theme': { args: []; return: string };

    // -------------------------------------------------------------------------
    // Topic Agent
    // -------------------------------------------------------------------------
    'topic:discover': {
        args: [message: string];
        return: {
            message: string;
            contexts?: any[];
            active_filter?: { name: string; definition: any };
        }
    };

    // -------------------------------------------------------------------------
    // Performance Monitoring
    // -------------------------------------------------------------------------
    'performance:getSnapshot': { args: []; return: PerformanceSnapshot };
    'performance:subscribe': { args: []; return: void };
    'performance:unsubscribe': { args: []; return: void };

    // -------------------------------------------------------------------------
    // AutoExpert / Sprout
    // -------------------------------------------------------------------------
    'sprout:start-session': {
        args: [seed: string, config?: any];
        return: { success: boolean; threadId?: string; error?: string };
    };
    'sprout:history': { args: []; return: SproutSession[] };
    'sprout:load': { args: [id: string]; return: { session: SproutSession; messages: SproutMessage[]; report: SproutReport | null } };
    'sprout:delete': { args: [id: string]; return: void };
}


// Performance Snapshot type (matches metrics-collector.ts)
export interface PerformanceSnapshot {
    timestamp: number;
    system: {
        cpuPercent: number;
        memoryUsedBytes: number;
        memoryTotalBytes: number;
        heapUsedBytes: number;
        appMemoryUsedBytes: number; // [NEW] Total App RSS
        mainProcessRSSBytes: number;
        externalMemoryBytes: number;
        eventLoopLagMs: number;
    };
    histograms: {
        [name: string]: {
            p50: number;
            p95: number;
            p99: number;
            count: number;
            avgMs: number;
        };
    };
    counters: {
        [name: string]: number;
    };
    gauges: {
        [name: string]: number;
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
