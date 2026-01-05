/**
 * Storage Module (Facade)
 * 
 * This module is being refactored to delegate to repositories.
 * It maintains backward compatibility while new code can use repositories directly.
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { JournalEntry, Snapshot } from '../shared/ipc-contract';
import { closeDatabase, getDbPath, initDatabase } from './infrastructure/database';
import { typedHandle } from './infrastructure/ipc/typed-ipc';
import { createRepositoryFactory, IRepositoryFactory } from './infrastructure/repositories';

// Backward compatibility: expose db for legacy code
let db: Database.Database | null = null;
let ipcConfigured = false;

// Repository factory instance
let repos: IRepositoryFactory | null = null;

let isResetting = false;

export function getIsResetting() {
    return isResetting;
}

/**
 * Get the repository factory.
 * Use this for new code instead of direct db access.
 */
export function getRepositories(): IRepositoryFactory | null {
    return repos;
}

/**
 * Initialize storage with database and repositories.
 */
export function initStorage() {
    try {
        // Use centralized database initialization
        db = initDatabase();

        // Initialize repositories
        repos = createRepositoryFactory(db);

        setupStorageIPC();
        ipcConfigured = true;
        console.log('[ShuTong] Storage initialized at', getDbPath());
    } catch (err) {
        console.error('[ShuTong] Failed to init storage:', err);
    }
}

// ... existing code ...

// Pulse Card Operations
export interface PulseCard {
    id: string;
    type: string;
    title: string;
    content: string;
    suggested_actions: string[];
    created_at: number;
}

export function savePulseCard(card: PulseCard) {
    return repos?.pulseCards.save(card) ?? false;
}

export function getPulseCards(limit = 50): PulseCard[] {
    return repos?.pulseCards.getMany(limit) ?? [];
}

export function getPulseCardById(id: string): PulseCard | null {
    return repos?.pulseCards.getById(id) ?? null;
}

export function updatePulseCard(card: Pick<PulseCard, 'id'> & Partial<Omit<PulseCard, 'id'>>) {
    return repos?.pulseCards.update(card) ?? false;
}

export function getLatestPulseCard(type: string): PulseCard | null {
    return repos?.pulseCards.getLatestByType(type) ?? null;
}

// --- Window Switch Events (Smart Capture Guard) ---

export interface WindowSwitchRecord {
    id?: number;
    timestamp: number;
    from_app: string | null;
    from_title: string | null;
    to_app: string;
    to_title: string;
    screenshot_id?: number | null;
    skip_reason?: string | null;
}

/**
 * Save a window switch event to the database.
 */
export function saveWindowSwitch(event: WindowSwitchRecord): number | null {
    return repos?.windowSwitches.save(event) ?? null;
}

/**
 * Get window switch events within a time range.
 */
export function getWindowSwitches(startTs: number, endTs: number, limit = 100): WindowSwitchRecord[] {
    return repos?.windowSwitches.getInRange(startTs, endTs, limit) ?? [];
}

/**
 * Get dwell time statistics for windows in a time range.
 * Returns array of { app, title, dwell_seconds } sorted by dwell time.
 */
export function getWindowDwellStats(startTs: number, endTs: number): { app: string; total_seconds: number }[] {
    return repos?.windowSwitches.getDwellStats(startTs, endTs) ?? [];
}

/**
 * Reset the database by clearing all user data.
 * Preserves settings table. Returns success/error result with statistics.
 * Uses a transaction to ensure atomicity of SQLite operations.
 */
export async function resetDatabase(): Promise<{ success: boolean; error?: string; stats?: { filesDeleted: number; tablesCleared: number } }> {
    if (!db) {
        return { success: false, error: 'Database not initialized' };
    }

    if (isResetting) {
        return { success: false, error: 'Reset already in progress' };
    }

    isResetting = true;
    const stats = { filesDeleted: 0, tablesCleared: 0 };

    try {
        console.log('[ShuTong] Resetting database...');

        // 0. Stop recording if active (to prevent file lock issues and ghost data)
        try {
            const { getIsRecording, stopRecording } = await import('./features/capture');
            if (getIsRecording()) {
                stopRecording();
                console.log('[ShuTong] Automatically stopped recording before reset');
            }
        } catch (err) {
            console.warn('[ShuTong] Failed to check/stop recording:', err);
        }

        // 1. Delete screenshot files from disk (Recursive)
        const screenshotDir = path.join(app.getPath('userData'), 'recordings');
        if (fs.existsSync(screenshotDir)) {
            // Helper to recursively delete
            const deleteFolderRecursive = (dirPath: string) => {
                if (fs.existsSync(dirPath)) {
                    fs.readdirSync(dirPath).forEach((file) => {
                        const curPath = path.join(dirPath, file);
                        if (fs.lstatSync(curPath).isDirectory()) { // recurse
                            deleteFolderRecursive(curPath);
                        } else { // delete file
                            fs.unlinkSync(curPath);
                            stats.filesDeleted++;
                        }
                    });
                    // Don't remove the root recordings dir itself, just content, or maybe recreate it?
                    // Actually, removing the folders inside 'recordings' is what we want.
                    // If we are deep inside, we remove the dir.
                    if (dirPath !== screenshotDir) {
                        fs.rmdirSync(dirPath);
                    }
                }
            };
            try {
                deleteFolderRecursive(screenshotDir);
            } catch (err) {
                console.warn('[ShuTong] Failed to delete recordings:', err);
            }
            console.log(`[ShuTong] Deleted ${stats.filesDeleted} screenshot files`);
        }

        // 2. Clear SQLite tables in a transaction (preserve settings)
        // ORDER MATTERS due to Foreign Key Constraints!
        // Delete CHILD tables first, then PARENTS.
        const tablesToClear = [
            'batch_screenshots',  // Links batches <-> screenshots
            'observations',       // Links to analysis_batches
            'timeline_cards',     // Links to analysis_batches
            'analysis_batches',   // Parent of above
            'screenshots',        // Parent of batch_screenshots
            'snapshots',          // Legacy
            'pulse_cards',
            'window_switches',
            'journal'
        ];

        const clearTablesTransaction = db.transaction(() => {
            for (const table of tablesToClear) {
                try {
                    db!.exec(`DELETE FROM ${table}`);
                    stats.tablesCleared++;
                } catch (e) {
                    console.error(`[ShuTong] FAILED to clear table ${table}:`, e);
                    throw e; // Abort transaction
                }
            }
        });

        try {
            clearTablesTransaction();
            console.log(`[ShuTong] Cleared ${stats.tablesCleared} SQLite tables`);
        } catch (err) {
            console.error('[ShuTong] Transaction failed, rolling back:', err);
            throw new Error('Failed to clear database tables');
        }

        // 3. Reset vector storage (activity context)
        try {
            const { vectorStorage } = await import('./storage/vector-storage');
            await vectorStorage.reset();
            console.log('[ShuTong] Reset vector storage');
        } catch (err) {
            console.warn('[ShuTong] Failed to reset vector storage:', err);
        }

        // 4. Reset checkpointer (Pulse chat history) and agent state
        try {
            const { pulseAgent } = await import('./features/pulse/agent/pulse-agent');
            pulseAgent.reset();
            console.log('[ShuTong] Reset Pulse agent');
        } catch (err) {
            console.warn('[ShuTong] Failed to reset Pulse agent:', err);
        }

        // 5. Reset memory store (Pulse long-term memories)
        try {
            const { memoryStore } = await import('./features/pulse/agent/memory-store');
            await memoryStore.reset();
            console.log('[ShuTong] Reset memory store');
        } catch (err) {
            console.warn('[ShuTong] Failed to reset memory store:', err);
        }

        console.log('[ShuTong] Database reset complete');
        return { success: true, stats };

    } catch (err: any) {
        console.error('[ShuTong] Failed to reset database:', err);
        return { success: false, error: err.message || 'Unknown error', stats };
    } finally {
        isResetting = false;
    }
}

export function closeStorage() {
    closeDatabase();
    db = null;
    repos = null;
    console.log('[ShuTong] Storage closed.');
}

// IPC Handlers for Storage
function setupStorageIPC() {
    if (ipcConfigured) return;

    // Snapshots
    typedHandle('get-snapshots', (_event: unknown, limit: number) => getSnapshots(limit));
    typedHandle('get-snapshots-by-date', (_event: unknown, date: string) => getSnapshotsByDate(date));

    // Settings
    typedHandle('get-settings', () => getSettings());
    typedHandle('set-setting', (_event: unknown, key: string, value: string) => setSetting(key, value));

    // Journal
    typedHandle('get-journal-entries', () => getJournalEntries());
    typedHandle('add-journal-entry', (_event: unknown, entry: { content: string; type: 'intention' | 'reflection' }) => {
        addJournalEntry(entry);
    });

    // Dashboard Stats
    typedHandle('get-dashboard-stats', () => getDashboardStats());

    // Reset Database
    typedHandle('reset-database', async () => {
        return await resetDatabase();
    });

    ipcConfigured = true;
}

// --- Phase 6: New Storage Functions ---

/**
 * Saves a screenshot with Unix timestamp and optional metadata.
 */
export function saveScreenshot(
    filePath: string,
    capturedAt: number,
    fileSize?: number,
    captureType?: string,
    appName?: string,
    windowTitle?: string,
    monitorId?: string,
    roi?: { x: number, y: number, w: number, h: number }
) {
    if (!db) return;
    try {
        const stmt = db.prepare(`
            INSERT INTO screenshots(captured_at, file_path, file_size, capture_type, app_bundle_id, window_title, monitor_id, roi_x, roi_y, roi_w, roi_h)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
            capturedAt, 
            filePath, 
            fileSize || null, 
            captureType || null, 
            appName || null,
            windowTitle || null,
            monitorId || null,
            roi?.x || null,
            roi?.y || null,
            roi?.w || null,
            roi?.h || null
        );
        return info.lastInsertRowid;
    } catch (err) {
        console.error('[ShuTong] Failed to save screenshot:', err);
        return null;
    }
}

/**
 * Fetches screenshots that have NOT been assigned to any batch yet.
 * Filter by 'since' timestamp to limit lookback (e.g. last 24h).
 */
export function fetchUnprocessedScreenshots(sinceTimestamp: number, limit: number = 1000) {
    if (!db) return [];
    try {
        const stmt = db.prepare(`
        SELECT * FROM screenshots
            WHERE captured_at >= ?
            AND is_deleted = 0
              AND id NOT IN(SELECT screenshot_id FROM batch_screenshots)
            ORDER BY captured_at ASC
            LIMIT ?
            `);
        return stmt.all(sinceTimestamp, limit) as any[];
    } catch (err) {
        console.error('[ShuTong] Failed to fetch unprocessed screenshots:', err);
        return [];
    }
}

/**
 * Creates a new batch and links screenshots to it.
 */
export function saveBatchWithScreenshots(startTs: number, endTs: number, screenshotIds: number[]) {
    if (!db || screenshotIds.length === 0) return null;

    const insertBatch = db.prepare(`
        INSERT INTO analysis_batches(batch_start_ts, batch_end_ts)
        VALUES(?, ?)
            `);

    const insertJunction = db.prepare(`
        INSERT INTO batch_screenshots(batch_id, screenshot_id)
        VALUES(?, ?)
            `);

    let batchId: number | bigint | null = null;

    try {
        const transaction = db.transaction(() => {
            const info = insertBatch.run(startTs, endTs);
            batchId = info.lastInsertRowid;
            for (const id of screenshotIds) {
                insertJunction.run(batchId, id);
            }
        });
        transaction();
        return batchId;
    } catch (err) {
        // Rollback is automatic with transaction
        console.error('[ShuTong] Failed to save batch:', err);
        return null;
    }
}

export function screenshotsForBatch(batchId: number) {
    if (!db) return [];
    try {
        const stmt = db.prepare(`
            SELECT s.* FROM batch_screenshots bs
            JOIN screenshots s ON s.id = bs.screenshot_id
            WHERE bs.batch_id = ?
            AND s.is_deleted = 0
            ORDER BY s.captured_at ASC
            `);
        return stmt.all(batchId) as any[];
    } catch (err) {
        console.error('[ShuTong] Failed to fetch screenshots for batch:', err);
        return [];
    }
}

export function getBatches(limit = 10) {
    if (!db) return [];
    try {
        const stmt = db.prepare('SELECT * FROM analysis_batches ORDER BY id DESC LIMIT ?');
        return stmt.all(limit);
    } catch (err) {
        console.error('[ShuTong] Failed to get batches:', err);
        return [];
    }
}

export function updateBatchStatus(batchId: number, status: string, reason?: string) {
    if (!db) return;
    try {
        const stmt = db.prepare('UPDATE analysis_batches SET status = ?, reason = ? WHERE id = ?');
        stmt.run(status, reason || null, batchId);
    } catch (err) {
        console.error('[ShuTong] Failed to update batch status:', err);
    }
}

export function saveObservation(batchId: number, startTs: number, endTs: number, observation: string, model?: string, contextType?: string, entities?: string): number | bigint | undefined {
    if (!db) return;
    try {
        const stmt = db.prepare(`
            INSERT INTO observations(batch_id, start_ts, end_ts, observation, llm_model, context_type, entities)
        VALUES(?, ?, ?, ?, ?, ?, ?)
            `);
        const info = stmt.run(batchId, startTs, endTs, observation, model || null, contextType || null, entities || null);
        return info.lastInsertRowid;
    } catch (err) {
        console.error('[ShuTong] Failed to save observation:', err);
    }
}

export function saveTimelineCard(card: {
    batchId?: number,
    startTs: number,
    endTs: number,
    category: string,
    subcategory?: string,
    title: string,
    summary: string,
    detailedSummary?: string,
    videoUrl?: string
}) {
    if (!db) return undefined;
    try {
        const stmt = db.prepare(`
            INSERT INTO timeline_cards(batch_id, start_ts, end_ts, category, subcategory, title, summary, detailed_summary, video_url)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
            card.batchId || null,
            card.startTs,
            card.endTs,
            card.category,
            card.subcategory || null,
            card.title,
            card.summary,
            card.detailedSummary || null,
            card.videoUrl || null
        );
        return info.lastInsertRowid;
    } catch (err) {
        console.error('[ShuTong] Failed to save timeline card:', err);
        return undefined;
    }
}

// ... existing helper functions (getSnapshots, etc.) - keeping them for now as legacy

export function addSnapshot(filePath: string) {
    // Deprecated but keeping for legacy compatibility if needed, 
    // though the Plan says to switch to saveScreenshot.
    // We will update capture.ts to use saveScreenshot instead.
    if (!db) return;
    try {
        const timestamp = new Date().toISOString();
        const stmt = db.prepare('INSERT INTO snapshots (file_path, timestamp) VALUES (?, ?)');
        stmt.run(filePath, timestamp);
    } catch (err) {
        console.error('[ShuTong] Failed to add snapshot:', err);
    }
}

export function getSnapshots(limit: number): Snapshot[] {
    if (!db) return [];
    try {
        const stmt = db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT ?');
        return stmt.all(limit) as Snapshot[];
    } catch (err) {
        console.error('[ShuTong] Failed to get snapshots:', err);
        return [];
    }
}

export function getSnapshotsByDate(date: string) {
    if (!db) return [];
    try {
        // Phase 6: Query 'screenshots' table instead of legacy 'snapshots'
        // date is "YYYY-MM-DD"
        const start = new Date(date).setHours(0, 0, 0, 0) / 1000;
        const end = new Date(date).setHours(23, 59, 59, 999) / 1000;

        const stmt = db.prepare('SELECT id, file_path, captured_at FROM screenshots WHERE captured_at BETWEEN ? AND ? ORDER BY captured_at ASC');
        const rows = stmt.all(start, end) as { id: number, file_path: string, captured_at: number }[];

        // Map to legacy format expected by frontend
        return rows.map(row => ({
            id: row.id,
            file_path: row.file_path,
            timestamp: new Date(row.captured_at * 1000).toISOString()
        }));

    } catch (err) {
        console.error('[ShuTong] Failed to get screenshots by date:', err);
        return [];
    }
}

export function getSettings() {
    const settings = repos?.settings.getAll() ?? {};
    // Inject current user data path so UI always knows the real location
    settings['recording_path'] = app.getPath('userData');
    return settings;
}

export function getSetting(key: string): string | null {
    return repos?.settings.get(key) ?? null;
}

export function getReminderSettings() {
    const s = getSettings();
    return {
        reminder_morning_enabled: s.reminder_morning_enabled === 'true',
        reminder_morning_time: s.reminder_morning_time || '09:00',
        reminder_evening_enabled: s.reminder_evening_enabled === 'true',
        reminder_evening_time: s.reminder_evening_time || '21:00'
    };
}

export function getRetentionSettings() {
    const s = getSettings();
    return {
        storage_retention_days: parseInt(s.storage_retention_days || '30', 10)
    };
}

export function getSnapshotsBefore(timestamp: number): { id: number, file_path: string }[] {
    // Note: This works on the OLD snapshots table which uses ISO strings but calls it "timestamp".
    // Wait, the new code should support cleanup too.
    // Ideally we should switch cleanup.ts to support both or just new.
    // For now leaving as is for 'snapshots'.
    if (!db) return [];
    try {
        // Warning: Comparing number to ISO string in DB might be weird if not careful, 
        // but existing logic likely handled it or assumed conversion.
        // Actually the old table `timestamp` is TEXT (ISO string).
        // Let's leave this alone primarily.
        const dateStr = new Date(timestamp).toISOString();
        const stmt = db.prepare('SELECT id, file_path FROM snapshots WHERE timestamp < ?');
        return stmt.all(dateStr) as { id: number, file_path: string }[];
    } catch (err) {
        console.error('[ShuTong] Failed to get old snapshots:', err);
        return [];
    }
}

export function deleteSnapshotsBefore(timestamp: number) {
    if (!db) return;
    try {
        const dateStr = new Date(timestamp).toISOString();
        const stmt = db.prepare('DELETE FROM snapshots WHERE timestamp < ?');
        stmt.run(dateStr);
    } catch (err) {
        console.error('[ShuTong] Failed to delete old snapshots:', err);
    }
}

export function setSetting(key: string, value: string) {
    if (!repos) {
        console.error(`[ShuTong] Cannot set setting ${key}, repositories not initialized`);
        return;
    }

    repos.settings.set(key, value);

    // Log non-sensitive settings
    const lowerKey = String(key).toLowerCase();
    const isSensitive =
        lowerKey.includes('api') ||
        lowerKey.includes('key') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret');
    if (!isSensitive) {
        console.log(`[ShuTong] Setting updated: ${key} = ${value}`);
    } else {
        console.log(`[ShuTong] Setting updated: ${key} = [REDACTED]`);
    }
}

export function addJournalEntry(entry: { content: string, type: 'intention' | 'reflection' }) {
    return repos?.journals.add(entry) ?? null;
}

export function getJournalEntries(): JournalEntry[] {
    return repos?.journals.getAll() ?? [];
}


// --- Phase 7: UI Accessors ---

export function getTimelineCards(limit = 50, offset = 0, search?: string, category?: string) {
    if (!db) return [];
    try {
        let query = 'SELECT * FROM timeline_cards';
        const params: any[] = [];
        const conditions: string[] = [];

        if (search && search.trim() !== '') {
            conditions.push('(title LIKE ? OR summary LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (category && category !== 'All') {
            conditions.push('category = ?');
            params.push(category);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY start_ts DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const stmt = db.prepare(query);
        return stmt.all(...params);
    } catch (err) {
        console.error('[ShuTong] Failed to get timeline cards:', err);
        return [];
    }
}

export function getCardDetails(cardId: number) {
    if (!db) return null;
    try {
        const card = db.prepare('SELECT * FROM timeline_cards WHERE id = ?').get(cardId);
        if (!card) return null;

        // Fetch related observations
        // Assuming card.batch_id is present. If logic changes to multi-batch cards, this needs update.
        // For now 1 card = 1 batch.
        const observations = db.prepare('SELECT * FROM observations WHERE batch_id = ? ORDER BY start_ts ASC').all((card as any).batch_id);

        return {
            ...card,
            observations
        };
    } catch (err) {
        console.error('[ShuTong] Failed to get card details:', err);
        return null;
    }
}

export function getScreenshotsForCard(cardId: number) {
    if (!db) return [];
    try {
        const card = db.prepare('SELECT batch_id FROM timeline_cards WHERE id = ?').get(cardId);
        if (!card) return [];

        const batchId = (card as any).batch_id;
        if (!batchId) return [];

        const stmt = db.prepare(`
            SELECT s.* FROM batch_screenshots bs
            JOIN screenshots s ON s.id = bs.screenshot_id
            WHERE bs.batch_id = ?
              AND s.is_deleted = 0
            ORDER BY s.captured_at ASC
        `);
        return stmt.all(batchId);
    } catch (err) {
        console.error('[ShuTong] Failed to get screenshots for card:', err);
        return [];
    }
}

export function getScreenshotsInTimeRange(startTs: number, endTs: number) {
    if (!db) return [];
    try {
        const stmt = db.prepare(`
            SELECT * FROM screenshots 
            WHERE captured_at BETWEEN ? AND ?
              AND is_deleted = 0
            ORDER BY captured_at ASC
        `);
        return stmt.all(startTs, endTs);
    } catch (err) {
        console.error('[ShuTong] Failed to get screenshots in range:', err);
        return [];
    }
}

export function updateCardVideoUrl(cardId: number, videoUrl: string) {
    if (!db) return;
    try {
        const stmt = db.prepare('UPDATE timeline_cards SET video_url = ? WHERE id = ?');
        stmt.run(videoUrl, cardId);
    } catch (err) {
        console.error('[ShuTong] Failed to update card video URL:', err);
    }
}

export function getDashboardStats() {
    if (!db) return { focusTime: '0h 0m', productivePercentage: 0, lastActivity: 'None' };
    try {
        const todayStart = new Date().setHours(0, 0, 0, 0) / 1000;

        interface DBCard {
            id: number;
            start_ts: number;
            end_ts: number;
            category: string;
            title: string;
        }

        const cards = db.prepare('SELECT * FROM timeline_cards WHERE start_ts >= ?').all(todayStart) as DBCard[];

        let totalSeconds = 0;
        let weightedScore = 0;
        let totalWeight = 0;

        const weights: Record<string, number> = {
            'Work': 1.0,
            'Meeting': 1.0,
            'Personal': 0.4,
            'Idle': 0,
            'Distraction': 0
        };

        cards.forEach((card: DBCard) => {
            const duration = card.end_ts - card.start_ts;
            totalSeconds += duration;

            const weight = weights[card.category] ?? 0.5;
            weightedScore += duration * weight;
            totalWeight += duration;
        });

        const focusHours = Math.floor(totalSeconds / 3600);
        const focusMins = Math.floor((totalSeconds % 3600) / 60);
        const focusTime = `${focusHours}h ${focusMins}m`;

        const productivePercentage = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
        const lastActivity = cards.length > 0 ? cards[0].title : 'None';

        return {
            focusTime,
            productivePercentage,
            lastActivity
        };
    } catch (err) {
        console.error('[ShuTong] Failed to get dashboard stats:', err);
        return { focusTime: '0h 0m', productivePercentage: 0, lastActivity: 'None' };
    }
}


export function exportTimelineMarkdown(date: string, filePath: string) {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
        const targetDate = new Date(date);
        const startOfDay = targetDate.setHours(0, 0, 0, 0) / 1000;
        const endOfDay = targetDate.setHours(23, 59, 59, 999) / 1000;

        interface DBCard {
            start_ts: number;
            end_ts: number;
            category: string;
            title: string;
            summary: string;
        }

        const cards = db.prepare(`
            SELECT start_ts, end_ts, category, title, summary 
            FROM timeline_cards 
            WHERE start_ts BETWEEN ? AND ? 
            ORDER BY start_ts ASC
        `).all(startOfDay, endOfDay) as DBCard[];

        if (cards.length === 0) {
            return { success: false, error: 'No activity found for this date.' };
        }

        // Calculate Stats
        let totalSeconds = 0;
        cards.forEach(c => totalSeconds += (c.end_ts - c.start_ts));
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);

        // Generate Markdown
        let md = `# ShuTong Activity Log - ${date}\n\n`;
        md += `**Total Focus Time:** ${hours}h ${mins}m\n\n`;
        md += `| Time | Category | Activity | Summary |\n`;
        md += `|---|---|---|---|\n`;

        cards.forEach(card => {
            const timeStr = new Date(card.start_ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            md += `| ${timeStr} | ${card.category} | **${card.title}** | ${card.summary} |\n`;
        });

        md += `\n*Exported by ShuTong on ${new Date().toLocaleString()}*\n`;

        fs.writeFileSync(filePath, md, 'utf-8');
        return { success: true, filePath };

    } catch (err: any) {
        console.error('[ShuTong] Failed to export markdown:', err);
        return { success: false, error: err.message };
    }
}
