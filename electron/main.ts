import { app, BrowserWindow, dialog, screen as electronScreen, ipcMain, net, protocol, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cancelMigration, commitMigration, getBootstrapConfig, PendingMigration, resolveUserDataPath, setCustomUserDataPath, setPendingMigration } from './bootstrap'
import { getMergedLLMConfig, setLLMProviderConfig, setRoleConfig } from './config_manager'
import { copyUserData } from './migration-utils'
import { getIsQuitting, setupTray, updateTrayMenu } from './tray'

// Resolve custom path before anything else
resolveUserDataPath();

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    show: false, // Prevent white screen
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    frame: false, // Frameless for all
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden', // Mac: Traffic lights, Win: None
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Show window only when ready
  win.once('ready-to-show', () => {
    win?.show();
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Window Control IPC
  ipcMain.handle('window-min', () => win?.minimize());
  ipcMain.handle('window-max', () => {
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });
  ipcMain.handle('window-close', () => win?.close());

  // Check max state for UI toggle
  win.on('maximize', () => win?.webContents.send('window-maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window-maximized', false));

  // Handle Close (Minimize to Tray)
  win.on('close', (event) => {
    if (!getIsQuitting()) {
      event.preventDefault();
      win?.hide();
      // On Windows/Linux it's good practice to hide to tray
    }
    return false;
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

import { startAnalysisJob } from './analysis'
import { getIsRecording, setupScreenCapture, startRecording, stopRecording } from './capture'
import { cleanupOldSnapshots } from './cleanup'
import { setupDeepLinks } from './deeplink'
import { checkReminders, sendNotification } from './scheduler'
import { closeStorage, getCardDetails, getReminderSettings, getRetentionSettings, getScreenshotsForCard, getTimelineCards, initStorage } from './storage'

app.on('activate', () => {
  // ...
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

import { createVideoGenerationWindow } from './video_service'

// Register custom protocol privileges
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      standard: true,
      stream: true, // Optimizes video streaming
      bypassCSP: true // Helps with CSP issues
    }
  },
  {
    scheme: 'local-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      standard: true,
      bypassCSP: true
    }
  }
]);

async function startApp() {
  try {
    console.log('[Main] App ready')

    // ========================================
    // STEP 1: Register ALL IPC handlers FIRST (SYNCHRONOUS)
    // This prevents race conditions with window loading
    // ========================================

    // Core Handlers
    ipcMain.handle('get-available-screens', () => {
      try {
        const displays = electronScreen.getAllDisplays();
        console.log(`[Main] Found ${displays.length} display(s)`);
        return displays.map((d: Electron.Display, idx: number) => ({
          id: d.id,
          name: d.label || `Display ${idx + 1} (${d.bounds.width}x${d.bounds.height})`
        }));
      } catch (err) {
        console.error('[Main] Failed to get screens:', err);
        return [{ id: 0, name: 'Primary Display' }];
      }
    });

    // Phase 5: Pulse Cards
    ipcMain.handle('get-pulse-cards', async (_, limit?: number) => {
      try {
        const { getPulseCards } = await import('./storage');
        const cards = getPulseCards(limit || 20);
        return { success: true, cards };
      } catch (err: any) {
        console.error('[Main] Failed to get pulse cards:', err);
        return { success: false, error: err.message, cards: [] };
      }
    });

    ipcMain.handle('generate-pulse-card', async (_, type: string) => {
      try {
        const { pulseAgent } = await import('./agent/pulse-agent');
        const { savePulseCard } = await import('./storage');
        // @ts-ignore
        const card = await pulseAgent.generateCard(type);
        const cardWithMeta = {
          id: `${type}-${Date.now()}`,
          type,
          title: card.title,
          content: card.content,
          suggested_actions: card.suggested_actions,
          created_at: Math.floor(Date.now() / 1000)
        };
        const saved = savePulseCard(cardWithMeta);
        if (!saved) console.warn('[Main] Failed to save pulse card');
        return { success: true, card: { ...card, created_at: cardWithMeta.created_at * 1000 } };
      } catch (err: any) {
        console.error('[Main] Pulse card generation failed:', err);
        return { success: false, error: err.message };
      }
    });

    // Phase 8: Pulse Research Proposals (v1)
    ipcMain.handle('generate-research-proposal', async () => {
      try {
        const { generateResearchProposalCard } = await import('./research/pulse-research');
        const { getPulseCardById } = await import('./storage');
        const result = await generateResearchProposalCard();
        if ('error' in result) return { success: false, error: result.error };
        const card = getPulseCardById(result.cardId);
        return { success: true, card };
      } catch (err: any) {
        console.error('[Main] Failed to generate research proposal:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('dismiss-research-proposal', async (_evt, cardId: string) => {
      try {
        const { dismissResearchProposal } = await import('./research/pulse-research');
        const result = await dismissResearchProposal(cardId);
        if ('error' in result) return { success: false, error: result.error };
        return { success: true };
      } catch (err: any) {
        console.error('[Main] Failed to dismiss proposal:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('start-research-from-proposal', async (_evt, payload: { cardId: string; mode: 'auto' | 'fast' | 'deep' }) => {
      try {
        const { startResearchFromProposal } = await import('./research/pulse-research');
        const result = await startResearchFromProposal(payload.cardId, payload.mode);
        if ('error' in result) return { success: false, error: result.error };
        return { success: true, deliverableCardIds: result.deliverableCardIds };
      } catch (err: any) {
        console.error('[Main] Failed to start research from proposal:', err);
        return { success: false, error: err.message };
      }
    });

    // Save Gate: Save or Discard deliverable cards
    ipcMain.handle('save-deliverable', async (_evt, cardId: string) => {
      try {
        const { saveDeliverable } = await import('./research/pulse-research');
        const result = await saveDeliverable(cardId);
        if ('error' in result) return { success: false, error: result.error };
        return { success: true };
      } catch (err: any) {
        console.error('[Main] Failed to save deliverable:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('discard-deliverable', async (_evt, cardId: string) => {
      try {
        const { discardDeliverable } = await import('./research/pulse-research');
        const result = await discardDeliverable(cardId);
        if ('error' in result) return { success: false, error: result.error };
        return { success: true };
      } catch (err: any) {
        console.error('[Main] Failed to discard deliverable:', err);
        return { success: false, error: err.message };
      }
    });

    // Phase 3: Pulse Agent
    ipcMain.handle('ask-pulse', async (_, question: string) => {
      try {
        const { pulseAgent } = await import('./agent/pulse-agent');
        const update = await pulseAgent.run(question);
        return { success: true, response: update };
      } catch (err: any) {
        console.error('[Main] Pulse agent failed:', err);
        return { success: false, error: err.message };
      }
    });

    // Phase 2: Semantic Search
    ipcMain.handle('search-semantic', async (_, query: string, limit?: number) => {
      try {
        const { vectorStorage } = await import('./storage/vector-storage');
        const results = await vectorStorage.search(query, limit || 10);
        return { success: true, results };
      } catch (err: any) {
        console.error('[Main] Semantic search failed:', err);
        return { success: false, error: err.message, results: [] };
      }
    });

    // Phase 7: UI Data
    ipcMain.handle('get-timeline-cards', (_, limit, offset, search, category) => {
      return getTimelineCards(limit, offset, search, category);
    });

    ipcMain.handle('get-card-details', (_, cardId) => {
      return getCardDetails(cardId);
    });

    ipcMain.handle('get-screenshots-for-card', (_, cardId) => {
      return getScreenshotsForCard(cardId);
    });

    ipcMain.handle('trigger-cleanup', async (_event, days) => {
      const count = await cleanupOldSnapshots(days);
      return count;
    });

    // LLM Configuration
    ipcMain.handle('get-llm-config', () => getMergedLLMConfig());

    ipcMain.handle('set-llm-provider-config', (_, providerName, config) => {
      setLLMProviderConfig(providerName, config);
      import('./storage/vector-storage').then(({ vectorStorage }) => {
        vectorStorage.refreshEmbeddingsConfig().catch(err => console.error('[Main] Failed to refresh embeddings config:', err));
      });
    });

    ipcMain.handle('set-role-config', (_, roleName, config) => {
      setRoleConfig(roleName, config);
      import('./storage/vector-storage').then(({ vectorStorage }) => {
        vectorStorage.refreshEmbeddingsConfig().catch(err => console.error('[Main] Failed to refresh embeddings config:', err));
      });
    });

    // Raw Config Handlers
    ipcMain.handle('get-raw-llm-config', async () => {
      const { getRawLLMConfig } = await import('./config_manager');
      return getRawLLMConfig();
    });

    ipcMain.handle('save-raw-llm-config', async (_, content) => {
      const { saveRawLLMConfig } = await import('./config_manager');
      const result = saveRawLLMConfig(content);
      if (result.success) {
        import('./storage/vector-storage').then(({ vectorStorage }) => {
          vectorStorage.refreshEmbeddingsConfig().catch(err => console.error('[Main] Failed to refresh embeddings config:', err));
        });
      }
      return result;
    });

    ipcMain.handle('import-llm-config', async () => {
      if (!win) return { success: false, error: 'No window' };
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'Cancelled' };

      try {
        const fs = await import('fs');
        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        return { success: true, content };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('export-llm-config', async (_, content) => {
      if (!win) return { success: false, error: 'No window' };
      const result = await dialog.showSaveDialog(win, {
        defaultPath: 'llm_config.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };

      try {
        const fs = await import('fs');
        fs.writeFileSync(result.filePath, content, 'utf-8');
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('export-timeline-markdown', async (_, date) => {
      if (!win) return { success: false, error: 'No window' };
      const { exportTimelineMarkdown } = await import('./storage');

      const result = await dialog.showSaveDialog(win, {
        defaultPath: `shutong-log-${date}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });

      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };

      return exportTimelineMarkdown(date, result.filePath);
    });

    ipcMain.handle('test-llm-connection', async (_, providerName, config, passedModelName) => {
      try {
        console.log(`[Main] Testing connection for ${providerName}...`);
        const { createLLMProviderFromConfig } = await import('./llm/providers');
        const { getMergedLLMConfig } = await import('./config_manager');

        let modelName = passedModelName;
        if (!modelName) {
          const fullConfig = getMergedLLMConfig();
          const providerConfig = fullConfig.providers[providerName];
          modelName = 'gpt-3.5-turbo';
          if (providerConfig && providerConfig.models) {
            const modelKeys = Object.keys(providerConfig.models);
            if (modelKeys.length > 0) modelName = modelKeys[0];
          }
        }

        console.log(`[Main] Using model ${modelName} for connection test.`);

        const provider = createLLMProviderFromConfig(providerName, config.apiKey, config.apiBaseUrl || '', modelName);

        // Check if it's an embedding model to test with embedQuery instead of generateContent
        const isEmbedding = modelName.toLowerCase().includes('embedding') ||
          modelName.toLowerCase().includes('bge') ||
          modelName.toLowerCase().includes('reranker');

        if (isEmbedding) {
          console.log(`[Main] Testing embedding for ${modelName}...`);
          if (!provider.embedQuery) {
            throw new Error(`Provider does not support embeddings for model: ${modelName}`);
          }
          await provider.embedQuery('Hello world');
        } else {
          console.log(`[Main] Testing chat completion for ${modelName}...`);
          await provider.generateContent({ prompt: 'Hello' });
        }

        return { success: true, message: 'Connection successful!' };
      } catch (error: any) {
        console.error(`[Main] Connection test failed for ${providerName}:`, error);
        return { success: false, message: error.message || 'Connection failed' };
      }
    });

    ipcMain.handle('select-directory', async (_, isOnboarding) => {
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Data Storage Location',
        message: 'All recordings, videos, and the database will be stored here.' + (isOnboarding ? '' : ' Requires restart.')
      });
      if (result.canceled) return null;

      const newPath = result.filePaths[0];

      if (isOnboarding === true) {
        try {
          console.log('[Main] Onboarding: Switching storage to', newPath);
          closeStorage();
          setCustomUserDataPath(newPath);
          app.setPath('userData', newPath);
          initStorage();
          return newPath;
        } catch (err) {
          console.error('[Main] Onboarding storage switch failed:', err);
          return null;
        }
      }

      setPendingMigration(newPath);

      const button = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Restart Required',
        message: 'The application needs to restart to move your data to the new location.',
        buttons: ['Restart Now', 'Cancel'],
        cancelId: 1
      });

      if (button.response === 0) {
        app.relaunch();
        app.quit();
        return newPath;
      } else {
        cancelMigration();
        return null;
      }
    });

    ipcMain.handle('open-data-folder', () => {
      shell.openPath(app.getPath('userData'));
    });

    ipcMain.handle('get-app-path', (_, name) => {
      return app.getPath(name);
    });

    console.log('[Main] IPC handlers registered')

    // ========================================
    // STEP 2: Initialize Storage (SYNCHRONOUS)
    // This MUST happen before window creation to ensure storage IPC handlers are ready
    // ========================================
    initStorage()
    console.log('[Main] Storage initialized')

    // ========================================
    // STEP 3: Create Window (handlers are ready now)
    // ========================================
    createWindow()
    console.log('[Main] Window created')

    // ========================================
    // STEP 4: Initialize async services (AFTER window created)
    // ========================================

    // Initialize Vector Storage (Async) - wrapped in try-catch to not block app startup
    try {
      const { vectorStorage } = await import('./storage/vector-storage');
      await vectorStorage.init();
      console.log('[Main] Vector storage initialized')

      // Phase 5: Check/Generate Daily Briefing (only if vector storage succeeds)
      const { checkAndGenerateBriefing } = await import('./scheduler');
      checkAndGenerateBriefing().catch(err => console.error('[Main] Scheduler error:', err));
    } catch (err) {
      console.error('[Main] Vector storage initialization failed:', err);
      // App continues without vector storage - semantic search will gracefully fail
    }

    setupScreenCapture()
    console.log('[Main] Screen capture setup')

    // Check if auto-start recording is enabled
    try {
      const { getSetting } = await import('./storage');
      const autoStart = getSetting('auto_start_recording');
      if (autoStart === 'true') {
        console.log('[Main] Auto-start recording enabled, starting...');
        startRecording();
      }
    } catch (err) {
      console.error('[Main] Failed to check auto-start setting:', err);
    }

    startAnalysisJob()
    console.log('[Main] Analysis job started')

    setupTray(() => win);

    // Sync Tray with Recording State
    // @ts-ignore
    app.on('recording-changed', (recording: boolean) => {
      updateTrayMenu(() => win, recording);
      win?.webContents.send('recording-state-changed', recording);
    });

    // Handle Tray Toggle
    // @ts-ignore
    app.on('tray-toggle-recording', async () => {
      const recording = getIsRecording();
      if (recording) {
        stopRecording();
      } else {
        startRecording();
      }
    });

    // Start Planner Loop (every minute)
    setInterval(() => {
      const settings = getReminderSettings();
      const notificationType = checkReminders(new Date(), settings);
      if (notificationType) {
        sendNotification(notificationType);
      }
    }, 60 * 1000);

    // Run Cleanup on startup (with small delay)
    setTimeout(() => {
      const retention = getRetentionSettings().storage_retention_days;
      cleanupOldSnapshots(retention);
    }, 10000); // 10s after startup

    // Auto-Updater Logic
    if (!VITE_DEV_SERVER_URL) {
      console.log('[Main] Checking for updates...');
      autoUpdater.checkForUpdatesAndNotify();
    }

    autoUpdater.on('update-available', () => {
      console.log('[Main] Update available');
      dialog.showMessageBox(win!, {
        type: 'info',
        title: 'Update Available',
        message: 'A new version of ShuTong is available. Downloading now...',
      });
    });

    autoUpdater.on('update-downloaded', () => {
      console.log('[Main] Update downloaded');
      dialog.showMessageBox(win!, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. Application will restart to update.',
        buttons: ['Restart']
      }).then((returnValue) => {
        if (returnValue.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });

    // Error Handling
    // @ts-ignore
    app.on('capture-error', (error: { title: string, message: string }) => {
      console.error('[Main] Capture Error:', error);
      if (win) {
        dialog.showErrorBox(error.title, error.message);
      }
    });

    protocol.handle('media', (request) => {
      // Strip protocol
      let filePath = request.url.slice('media://'.length)
      // Decode URI
      filePath = decodeURIComponent(filePath)
      // Remove leading slashes (handle media:/// and media://)
      while (filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
      // Fix missing drive colon (common with standard scheme normalization on Windows)
      if (/^[a-zA-Z]\//.test(filePath)) {
        filePath = filePath[0] + ':' + filePath.slice(1);
      }
      const targetUrl = 'file:///' + filePath
      return net.fetch(targetUrl)
    })

    protocol.handle('local-file', (request) => {
      let filePath = request.url.slice('local-file://'.length);
      filePath = decodeURIComponent(filePath);
      while (filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
      if (/^[a-zA-Z]\//.test(filePath)) {
        filePath = filePath[0] + ':' + filePath.slice(1);
      }
      const targetUrl = 'file:///' + filePath;
      return net.fetch(targetUrl);
    });

    createVideoGenerationWindow();
    console.log('[Main] Video generation service started');

  } catch (error) {
    console.error('[Main] Startup error:', error)
  }
}

async function runMigrationMode(migration: PendingMigration) {
  console.log('[Main] Entering Migration Mode');
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // For simple migration.html IPC
    }
  });

  // Load static migration file
  const migrationFile = path.join(process.env.VITE_PUBLIC!, 'migration.html');
  win.loadFile(migrationFile);

  // Handle cancel
  ipcMain.on('cancel-migration', () => {
    cancelMigration();
    app.relaunch();
    app.quit();
  });

  win.once('ready-to-show', async () => {
    win.show();
    try {
      const currentPath = app.getPath('userData');
      const targetPath = migration.targetPath;

      console.log(`[Main/Migration] Moving from ${currentPath} to ${targetPath}`);

      await copyUserData(currentPath, targetPath, (file) => {
        win.webContents.send('migration-progress', { file });
      });

      commitMigration();
      console.log('[Main/Migration] Success. Restarting...');

      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 1000);

    } catch (err: any) {
      console.error('[Main/Migration] Failed:', err);
      win.webContents.send('migration-error', err.message);
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // Deep Link Setup
  setupDeepLinks({
    onStartRecording: () => {
      console.log('[Main] Deep link: Start Recording');
      startRecording();
    },
    onStopRecording: () => {
      console.log('[Main] Deep link: Stop Recording');
      stopRecording();
    }
  });

  app.whenReady().then(async () => {
    const config = getBootstrapConfig();
    if (config.pendingMigration) {
      await runMigrationMode(config.pendingMigration);
    } else {
      await startApp();
    }
  });
}



process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled Rejection at:', promise, 'reason:', reason);
});
