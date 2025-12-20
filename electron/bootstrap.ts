import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Use appData path (e.g. C:\Users\xxx\AppData\Roaming) + appName to find the default userData directory
// This allows us to find the bootstrap config even if userData has already been redirected.
const DEFAULT_USER_DATA = path.join(app.getPath('appData'), app.name);
const BOOTSTRAP_FILE = path.join(DEFAULT_USER_DATA, 'bootstrap.json');

console.log('[Bootstrap] Initialized');
console.log(`[Bootstrap] App Name: ${app.name}`);
console.log(`[Bootstrap] Standard User Data Path (System Default): ${DEFAULT_USER_DATA}`);
console.log(`[Bootstrap] Bootstrap File: ${BOOTSTRAP_FILE}`);

export interface PendingMigration {
    targetPath: string;
    timestamp: number;
}

export interface BootstrapConfig {
    userDataPath: string | null;
    pendingMigration?: PendingMigration;
}

function readConfig(): BootstrapConfig {
    try {
        if (!fs.existsSync(DEFAULT_USER_DATA)) {
            fs.mkdirSync(DEFAULT_USER_DATA, { recursive: true });
        }
        if (fs.existsSync(BOOTSTRAP_FILE)) {
            const content = fs.readFileSync(BOOTSTRAP_FILE, 'utf-8');
            return JSON.parse(content);
        }
    } catch (err) {
        console.error('[Bootstrap] Failed to read bootstrap config:', err);
    }
    return { userDataPath: null };
}

function writeConfig(config: BootstrapConfig) {
    try {
        if (!fs.existsSync(DEFAULT_USER_DATA)) {
            fs.mkdirSync(DEFAULT_USER_DATA, { recursive: true });
        }
        fs.writeFileSync(BOOTSTRAP_FILE, JSON.stringify(config, null, 2));
        console.log('[Bootstrap] Config updated.');
    } catch (err) {
        console.error('[Bootstrap] Failed to write bootstrap config:', err);
    }
}

export function getBootstrapConfig(): BootstrapConfig {
    return readConfig();
}

/**
 * Returns the configured userData path, ignoring pending migrations.
 */
export function getCustomUserDataPath(): string | null {
    return readConfig().userDataPath;
}

/**
 * Directly sets the user data path (Legacy/Manual usage).
 * prefer using Migration flow.
 */
export function setCustomUserDataPath(newPath: string | null) {
    const config = readConfig();
    config.userDataPath = newPath;
    writeConfig(config);
}

export function setPendingMigration(targetPath: string) {
    const config = readConfig();
    config.pendingMigration = {
        targetPath,
        timestamp: Date.now()
    };
    writeConfig(config);
}

export function commitMigration() {
    const config = readConfig();
    if (config.pendingMigration) {
        config.userDataPath = config.pendingMigration.targetPath;
        delete config.pendingMigration;
        writeConfig(config);
    }
}

export function cancelMigration() {
    const config = readConfig();
    delete config.pendingMigration;
    writeConfig(config);
}

/**
 * Call this as early as possible in main process
 */
export function resolveUserDataPath() {
    const config = readConfig();

    // If there is a pending migration, we DO NOT redirect yet.
    // The main process will detect this and enter "Migration Mode"
    if (config.pendingMigration) {
        console.log('[Bootstrap] Pending migration detected. Skipping userData redirection.');
        return;
    }

    if (config.userDataPath) {
        console.log(`[Bootstrap] Redirecting userData to: ${config.userDataPath}`);
        app.setPath('userData', config.userDataPath);
    }
}
