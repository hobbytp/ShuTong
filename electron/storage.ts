import Database from 'better-sqlite3';
import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

function getDbPath() {
    return path.join(app.getPath('userData'), 'shutong.sqlite');
}

export function initStorage() {
    try {
        db = new Database(getDbPath());
        db.pragma('journal_mode = WAL');

        // Existing Schema (Legacy)
        db.exec(`
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                summary TEXT
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
        `);

        // Phase 6 Schema: Analysis Pipeline
        db.exec(`
            -- 1. Screenshots (replaces snapshots with Unix TS and extensible cols)
            CREATE TABLE IF NOT EXISTS screenshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at INTEGER NOT NULL,  -- Unix timestamp (seconds)
                file_path TEXT NOT NULL,
                file_size INTEGER,
                is_deleted INTEGER DEFAULT 0,
                capture_type TEXT,             -- Future: 'fullscreen', 'window', 'region'
                app_bundle_id TEXT,            -- Future: focused app
                window_title TEXT              -- Future: window title
            );
            CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at);

            -- 2. Analysis Batches (groups of screenshots)
            CREATE TABLE IF NOT EXISTS analysis_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_start_ts INTEGER NOT NULL,
                batch_end_ts INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, analyzed, failed
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_batches_status ON analysis_batches(status);

            -- 3. Batch Screenshots (Junction table)
            CREATE TABLE IF NOT EXISTS batch_screenshots (
                batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
                screenshot_id INTEGER NOT NULL REFERENCES screenshots(id),
                PRIMARY KEY (batch_id, screenshot_id)
            );

            -- 4. Observations (Raw AI transcription)
            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER NOT NULL REFERENCES analysis_batches(id),
                start_ts INTEGER NOT NULL,
                end_ts INTEGER NOT NULL,
                observation TEXT NOT NULL,
                llm_model TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 5. Timeline Cards (Final Output)
            CREATE TABLE IF NOT EXISTS timeline_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER REFERENCES analysis_batches(id),
                start_ts INTEGER NOT NULL,
                end_ts INTEGER NOT NULL,
                category TEXT NOT NULL,
                subcategory TEXT,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                detailed_summary TEXT,
                video_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_timeline_cards_start_ts ON timeline_cards(start_ts);
        `);

        setupStorageIPC();
        console.log('[ShuTong] Storage initialized at', getDbPath());
    } catch (err) {
        console.error('[ShuTong] Failed to init storage:', err);
    }
}

// IPC Handlers for Storage
function setupStorageIPC() {
    ipcMain.handle('get-snapshots', (_: any, limit: any) => getSnapshots(limit));
    ipcMain.handle('get-snapshots-by-date', (_: any, date: any) => getSnapshotsByDate(date));

    // Settings
    ipcMain.handle('get-settings', () => getSettings());
    ipcMain.handle('set-setting', (_: any, key: any, value: any) => setSetting(key, value));

    // Journal
    ipcMain.handle('get-journal-entries', () => getJournalEntries());
    ipcMain.handle('add-journal-entry', (_: any, entry: any) => addJournalEntry(entry));

    // Dashboard Stats
    ipcMain.handle('get-dashboard-stats', () => getDashboardStats());
}

// --- Phase 6: New Storage Functions ---

/**
 * Saves a screenshot with Unix timestamp.
 */
export function saveScreenshot(filePath: string, capturedAt: number, fileSize?: number) {
    if (!db) return;
    try {
        const stmt = db.prepare(`
            INSERT INTO screenshots(captured_at, file_path, file_size)
        VALUES(?, ?, ?)
            `);
        const info = stmt.run(capturedAt, filePath, fileSize || null);
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
export function fetchUnprocessedScreenshots(sinceTimestamp: number) {
    if (!db) return [];
    try {
        const stmt = db.prepare(`
        SELECT * FROM screenshots
            WHERE captured_at >= ?
            AND is_deleted = 0
              AND id NOT IN(SELECT screenshot_id FROM batch_screenshots)
            ORDER BY captured_at ASC
            `);
        return stmt.all(sinceTimestamp) as any[];
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

export function saveObservation(batchId: number, startTs: number, endTs: number, observation: string, model?: string) {
    if (!db) return;
    try {
        const stmt = db.prepare(`
            INSERT INTO observations(batch_id, start_ts, end_ts, observation, llm_model)
        VALUES(?, ?, ?, ?, ?)
            `);
        stmt.run(batchId, startTs, endTs, observation, model || null);
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

export function getSnapshots(limit: number) {
    if (!db) return [];
    try {
        const stmt = db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT ?');
        return stmt.all(limit);
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
    if (!db) return {};
    try {
        const stmt = db.prepare('SELECT key, value FROM settings');
        const rows = stmt.all() as { key: string, value: string }[];
        const settings: Record<string, string> = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        return settings;
    } catch (err) {
        console.error('[ShuTong] Failed to get settings:', err);
        return {};
    }
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
    if (!db) return;
    try {
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run(key, value);
        console.log(`[ShuTong] Set setting ${key} = ${value} `);
    } catch (err) {
        console.error('[ShuTong] Failed to set setting:', err);
    }
}

export function addJournalEntry(entry: { content: string, type: 'intention' | 'reflection' }) {
    if (!db) return;
    try {
        const timestamp = new Date().toISOString();
        const stmt = db.prepare('INSERT INTO journal (content, type, timestamp) VALUES (?, ?, ?)');
        stmt.run(entry.content, entry.type, timestamp);
    } catch (err) {
        console.error('[ShuTong] Failed to add journal entry:', err);
    }
}


export function getJournalEntries() {
    if (!db) return [];
    try {
        const stmt = db.prepare('SELECT * FROM journal ORDER BY id DESC');
        return stmt.all();
    } catch (err) {
        console.error('[ShuTong] Failed to get journal entries:', err);
        return [];
    }
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
