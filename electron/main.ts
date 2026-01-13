// Load environment variables FIRST, before any LangChain imports
import 'dotenv/config';

import { app, BrowserWindow, dialog, screen as electronScreen, ipcMain, nativeImage, net, protocol, shell } from 'electron';
import { execSync } from 'node:child_process';

// Force UTF-8 encoding for Windows terminal
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch (e) {
    // Ignore errors in non-interactive environments
  }
}

import { createLLMProviderFromConfig } from './llm/providers';

import { autoUpdater } from 'electron-updater';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancelMigration, commitMigration, getBootstrapConfig, PendingMigration, resolveUserDataPath, setCustomUserDataPath, setPendingMigration } from './bootstrap';
import { getMergedLLMConfig, getRawLLMConfig, saveRawLLMConfig, setLLMProviderConfig, setRoleConfig } from './config_manager';
import { analyticsService } from './features/analytics/analytics.service';
import { backupService, setupBackupIPC } from './features/backup';
import { captureShutdownService, getIsRecording, startRecording, stopRecording } from './features/capture';
import { setupAnalyticsIPC } from './features/timeline';
import { ocrService } from './features/timeline/ocr.service';
import { createVideoGenerationWindow, setupVideoIPC, setupVideoSubscribers } from './features/video';
import { eventBus } from './infrastructure/events';
import { lifecycleManager } from './infrastructure/lifecycle';
import { setupPerformanceIPC } from './infrastructure/monitoring';
import { getLLMMetrics } from './llm/metrics';
import { copyUserData } from './migration-utils';
import { storageShutdownService } from './storage';
import { getIsQuitting, setupTray, updateTrayMenu } from './tray';

// Initialize i18next
async function initI18n() {
  const currentLang = getSetting('language') || 'en';

  if (!process.env.VITE_PUBLIC) {
    console.warn('[Main] VITE_PUBLIC not set, skipping i18n init');
    return;
  }

  await i18next
    .use(Backend)
    .init({
      lng: currentLang,
      fallbackLng: 'en',
      backend: {
        loadPath: path.join(process.env.VITE_PUBLIC, 'locales/{{lng}}/{{ns}}.json'),
      }
    });
  console.log(`[Main] i18n initialized with language: ${currentLang}`);
}

// Set App name and User Model ID for Windows taskbar icon
app.name = 'ShuTong';
if (process.platform === 'win32') {
  app.setAppUserModelId('com.raytan.shutong');
}

// GPU Flags for Screen Capture Stability
// WGC (Windows Graphics Capture) can be unstable with aggressive GPU flags.
// We use conservative settings to prioritize capture reliability over raw performance.

// Keep GPU rasterization for general UI performance
app.commandLine.appendSwitch('enable-gpu-rasterization');

// Hardware acceleration for video (encoding/decoding)
app.commandLine.appendSwitch('enable-accelerated-video-decode');

// REMOVED: These flags were causing issues:
// - 'in-process-gpu' - causes UI rendering failure on dual-GPU laptops
// - 'disable-gpu-sandbox' - can destabilize WGC on some systems
// - 'force_high_performance_gpu' - causes GPU contention with WGC
// - 'enable-zero-copy' - can conflict with WGC frame buffer access

console.log('[Main] GPU flags configured for capture stability');

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
  // Use .ico for Windows taskbar (better native support), PNG for other platforms
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'ShuTong.png';

  win = new BrowserWindow({
    show: false, // Will show after ready-to-show
    transparent: true, // Enable transparency for floating splash
    // backgroundColor: '#09090b', // REMOVED: Must be removed for transparency to work
    icon: nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, iconFile)),
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

  // Proxy backup progress events to window
  // Remove listener to prevent duplicates if window re-created (unlikely here but safe)
  backupService.removeAllListeners('progress');
  backupService.on('progress', (e) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('backup:progress', e);
    }
  });

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

  return win; // Return window instance for async flow
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('will-quit', async (e) => {
  e.preventDefault();
  await lifecycleManager.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

import { setupDeepLinks } from './deeplink';
import { setupScreenCapture } from './features/capture';
import { cleanupOldSnapshots, startAnalysisJob } from './features/timeline';
import { checkReminders, sendNotification } from './scheduler';
import { closeStorage, exportTimelineMarkdown, getCardDetails, getIsResetting, getPulseCardById, getPulseCards, getReminderSettings, getRetentionSettings, getScreenshotsForCard, getSetting, getTimelineCards, initStorage, savePulseCard, setSetting } from './storage';

app.on('activate', () => {
  // ...
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})


// Register custom protocol privileges
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: false, // Changed to false to avoid mixed content issues in dev
      supportFetchAPI: true,
      standard: true,
      stream: true,
      bypassCSP: true
    }
  },
  {
    scheme: 'local-file',
    privileges: {
      secure: false,
      supportFetchAPI: true,
      standard: true,
      bypassCSP: true
    }
  }
]);

// import { topicAgent } from './features/topic/topic-agent';
// Lazy load topicAgent inside startApp

async function startApp() {
  try {
    // Register protocol handlers BEFORE creating window to prevent race condition
    protocol.handle('media', (request) => {
      try {
        let filePath = request.url.replace(/^media:\/*/, '');
        filePath = decodeURIComponent(filePath);
        if (process.platform === 'win32' && /^[a-zA-Z]\//.test(filePath)) {
          filePath = filePath[0] + ':' + filePath.slice(1);
        }
        const targetUrl = 'file:///' + filePath;
        // console.log(`[Main] Media request: ${request.url} -> ${targetUrl}`);
        return net.fetch(targetUrl);
      } catch (err) {
        console.error('[Main] Media protocol error:', err);
        return new Response('Error loading media', { status: 500 });
      }
    });

    protocol.handle('local-file', (request) => {
      try {
        let filePath = request.url.replace(/^local-file:\/*/, '');
        filePath = decodeURIComponent(filePath);
        if (process.platform === 'win32' && /^[a-zA-Z]\//.test(filePath)) {
          filePath = filePath[0] + ':' + filePath.slice(1);
        }
        const targetUrl = 'file:///' + filePath;
        return net.fetch(targetUrl);
      } catch (err) {
        console.error('[Main] Local-file protocol error:', err);
        return new Response('Error loading file', { status: 500 });
      }
    });

    // Register before-quit handler
    app.on('before-quit', (e) => {
      if (getIsResetting()) {
        e.preventDefault();
        dialog.showErrorBox('Cannot Quit', 'Database reset in progress.');
        return;
      }
      if (backupService.isInProgress) {
        e.preventDefault();
        dialog.showErrorBox('Cannot Quit', 'Data backup in progress.');
        return;
      }
    });

    // 1. Immediate Window Creation (BOOTING State)
    // Frontend defaults to BOOTING state, no IPC needed here
    // (webContents may not be ready to receive messages yet)
    const win = createWindow();
    // win.show(); // REMOVED: Rely on 'ready-to-show' event in createWindow to avoid white flash

    console.log('[Main] Window created & shown (BOOTING)');

    // ========================================
    // App Lifecycle State Management
    // ========================================
    // Track current state so Frontend can query it on mount (avoids race condition)
    let appLifecycleState: 'BOOTING' | 'HYDRATING' | 'READY' | 'ERROR' = 'BOOTING';

    // Helper to update and broadcast state
    const setAppLifecycleState = (state: typeof appLifecycleState) => {
      appLifecycleState = state;
      win.webContents.send('app-lifecycle', state);
      console.log(`[Main] Lifecycle -> ${state}`);
    };

    // Allow Frontend to query current state (for late mount)
    ipcMain.handle('get-app-lifecycle', () => appLifecycleState);

    // ========================================
    // STEP 1: Register ALL IPC handlers FIRST (SYNCHRONOUS)
    // ========================================

    // 2. Hydrate Storage (HYDRATING State) - MOVED HERE to prevent IPC race conditions
    initStorage();
    console.log('[Main] Storage initialized (HYDRATING)');

    // Register Core Services for Shutdown
    lifecycleManager.register(storageShutdownService);
    lifecycleManager.register(captureShutdownService);
    lifecycleManager.register(ocrService);
    console.log('[Main] Registered core services for graceful shutdown');

    // Notify Frontend: Storage ready (Sidebar can slide in, Content blurred)
    setAppLifecycleState('HYDRATING');

    setupAnalyticsIPC();
    setupVideoIPC();
    setupBackupIPC();

    // Initialize Analytics Service (IPC)
    void analyticsService;

    // Initialize Agents (Lazy Loaded later)
    // void topicAgent; // Moved to async block

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

    ipcMain.handle('get-pulse-cards', async (_, limit?: number) => {
      try {

        const cards = getPulseCards(limit || 20);
        return { success: true, cards };
      } catch (err: any) {
        return { success: false, error: err.message, cards: [] };
      }
    });

    ipcMain.handle('generate-pulse-card', async (_, type: string) => {
      try {
        const { pulseAgent } = await import('./features/pulse/agent/pulse-agent');

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
        savePulseCard(cardWithMeta);
        return { success: true, card: { ...card, created_at: cardWithMeta.created_at * 1000 } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('generate-research-proposal', async () => {
      try {
        const { generateResearchProposalCard } = await import('./research/pulse-research');

        const result = await generateResearchProposalCard();
        if ('error' in result) return { success: false, error: result.error };
        const card = getPulseCardById(result.cardId);
        return { success: true, card };
      } catch (err: any) {
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
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('save-deliverable', async (_evt, cardId: string) => {
      try {
        const { saveDeliverable } = await import('./research/pulse-research');
        const result = await saveDeliverable(cardId);
        if ('error' in result) return { success: false, error: result.error };
        return { success: true };
      } catch (err: any) {
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
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('ask-pulse', async (_, payload: string | { question: string; threadId?: string }) => {
      try {
        const { pulseAgent } = await import('./features/pulse/agent/pulse-agent');
        // Support both old (string) and new ({ question, threadId }) format
        const question = typeof payload === 'string' ? payload : payload.question;
        const threadId = typeof payload === 'object' ? payload.threadId : undefined;
        const update = await pulseAgent.run(question, { thread_id: threadId });
        return { success: true, response: update };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('search-semantic', async (_, query: string, limit?: number) => {
      try {
        const { vectorStorage } = await import('./storage/vector-storage');
        const results = await vectorStorage.search(query, limit || 10);
        return { success: true, results };
      } catch (err: any) {
        return { success: false, error: err.message, results: [] };
      }
    });

    ipcMain.handle('sprout:start-session', async (_, seed: string, config?: any) => {
      try {
        const { autoExpertAgent } = await import('./features/sprout/agent');
        const threadId = `sprout-${Date.now()}`;

        // Create a promise that resolves with initial experts from first supervisor output
        let resolveInitialExperts!: (experts: any[]) => void;
        const initialExpertsPromise = new Promise<any[]>((resolve) => {
          resolveInitialExperts = resolve;
          // Timeout fallback in case experts never come
          setTimeout(() => resolve([]), 5000);
        });

        // Start streaming in background
        (async () => {
          try {
            const iterator = autoExpertAgent.streamSession(seed, threadId, config);
            let expertsResolved = false;

            for await (const chunk of iterator) {
              // Check for initial experts from supervisor node
              if (!expertsResolved) {
                const supervisorData = chunk.supervisor;
                if (supervisorData?.experts && Array.isArray(supervisorData.experts) && supervisorData.experts.length > 0) {
                  resolveInitialExperts(supervisorData.experts);
                  expertsResolved = true;
                }
              }

              if (win && !win.isDestroyed()) {
                win.webContents.send(`sprout:update:${threadId}`, chunk);
              }
            }

            // Resolve with empty if no experts found
            if (!expertsResolved) {
              resolveInitialExperts([]);
            }

            if (win && !win.isDestroyed()) {
              win.webContents.send(`sprout:complete:${threadId}`, { status: 'done' });
            }
          } catch (e: any) {
            console.error("[Sprout] Stream error:", e);
            if (win && !win.isDestroyed()) {
              win.webContents.send(`sprout:error:${threadId}`, { error: e.message });
            }
          }
        })();

        // Wait for initial experts before returning
        const initialExperts = await initialExpertsPromise;
        console.log('[Sprout] Returning initial experts to frontend:', initialExperts.length);

        return { success: true, threadId, initialExperts };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

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

    ipcMain.handle('get-llm-config', () => getMergedLLMConfig());

    // LLM Metrics handlers
    ipcMain.handle('llm:getMetrics', () => {
      return getLLMMetrics().getSummary();
    });

    ipcMain.handle('llm:resetMetrics', () => {
      getLLMMetrics().reset();
    });

    // OCR Status handler
    ipcMain.handle('ocr:getStatus', () => {
      return ocrService.getStatus();
    });

    // Performance Monitoring
    setupPerformanceIPC();

    ipcMain.handle('set-llm-provider-config', (_, providerName, config) => {
      setLLMProviderConfig(providerName, config);
      import('./storage/vector-storage').then(({ vectorStorage }) => {
        vectorStorage.refreshEmbeddingsConfig();
      });
    });

    ipcMain.handle('set-role-config', (_, roleName, config) => {
      setRoleConfig(roleName, config);
      import('./storage/vector-storage').then(({ vectorStorage }) => {
        vectorStorage.refreshEmbeddingsConfig();
      });
    });

    ipcMain.handle('get-raw-llm-config', async () => {

      return getRawLLMConfig();
    });

    ipcMain.handle('save-raw-llm-config', async (_, content) => {

      const result = saveRawLLMConfig(content);
      if (result.success) {
        import('./storage/vector-storage').then(({ vectorStorage }) => {
          vectorStorage.refreshEmbeddingsConfig();
        });
      }
      return result;
    });

    ipcMain.handle('import-llm-config', async () => {
      // ... (simplified for brevity but functional logic remains)
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

      const result = await dialog.showSaveDialog(win, {
        defaultPath: `shutong-log-${date}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
      return exportTimelineMarkdown(date, result.filePath);
    });

    ipcMain.handle('test-llm-connection', async (_, providerName, config, passedModelName) => {
      try {

        let modelName = passedModelName;
        if (!modelName) {
          const fullConfig = getMergedLLMConfig();
          const providerConfig = fullConfig.providers[providerName];
          modelName = 'gpt-3.5-turbo';
          if (providerConfig && providerConfig.models) {
            const keys = Object.keys(providerConfig.models);
            if (keys.length > 0) modelName = keys[0];
          }
        }
        const provider = createLLMProviderFromConfig(providerName, config.apiKey, config.apiBaseUrl || '', modelName);
        const isEmbedding = modelName.toLowerCase().includes('embedding') || modelName.toLowerCase().includes('bge');
        if (isEmbedding) {
          if (!provider.embedQuery) throw new Error(`Provider does not support embeddings: ${modelName}`);
          await provider.embedQuery('Hello');
        } else {
          await provider.generateContent({ prompt: 'Hello' });
        }
        return { success: true, message: 'Connection successful!' };
      } catch (error: any) {
        return { success: false, message: error.message || 'Connection failed' };
      }
    });

    ipcMain.handle('select-directory', async (_, isOnboarding) => {
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Data Storage Location',
        message: 'All recordings... stored here.'
      });
      if (result.canceled) return null;
      const newPath = result.filePaths[0];

      if (isOnboarding === true) {
        try {
          closeStorage();
          setCustomUserDataPath(newPath);
          app.setPath('userData', newPath);
          initStorage();
          return newPath;
        } catch (err) { return null; }
      }
      setPendingMigration(newPath);
      const button = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Restart Required',
        message: 'Restart to move data.',
        buttons: ['Restart Now', 'Cancel']
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

    ipcMain.handle('open-data-folder', () => shell.openPath(app.getPath('userData')));
    ipcMain.handle('get-app-path', (_, name) => app.getPath(name));

    ipcMain.handle('change-language', async (_, lang: string) => {
      setSetting('language', lang);
      await i18next.changeLanguage(lang);
      updateTrayMenu(() => win, getIsRecording());
      // Notify all windows
      BrowserWindow.getAllWindows().forEach(w => {
        w.webContents.send('language-changed', lang);
      });
      return { success: true };
    });

    ipcMain.handle('change-theme', async (_, theme: string) => {
      setSetting('theme', theme);
      // Notify all windows
      BrowserWindow.getAllWindows().forEach(w => {
        w.webContents.send('theme-changed', theme);
      });
      return { success: true };
    });

    ipcMain.handle('get-theme', () => {
      return getSetting('theme') || 'dark';
    });

    ipcMain.handle('get-language', () => {
      return getSetting('language') || 'en';
    });

    console.log('[Main] IPC handlers registered')

    // 2. Hydrate Storage (Moved to earlier phase)
    // initStorage() called above.

    // === DEV ONLY: Slow Motion Testing ===
    // Set to > 0 to add artificial delay between phases (in ms)
    const DEV_STARTUP_DELAY = 0; // e.g., 2000 for 2s delay
    if (DEV_STARTUP_DELAY > 0) {
      console.log(`[Main] DEV: Waiting ${DEV_STARTUP_DELAY}ms before Agent init...`);
      await new Promise(resolve => setTimeout(resolve, DEV_STARTUP_DELAY));
    }

    // Warmup OCR in background (non-blocking)
    ocrService.warmup().catch(err =>
      console.warn('[Main] OCR warmup failed:', err)
    );

    // Initialize I18n AFTER storage is ready (needs settings)
    await initI18n();
    console.log('[Main] I18n initialized');

    // 3. Initialize Agents & Heavy Services (READY State)
    try {
      const { vectorStorage } = await import('./storage/vector-storage');
      await vectorStorage.init();
      lifecycleManager.register(vectorStorage);
      console.log('[Main] Vector storage initialized');

      // Initialize Memory Store for PulseAgent
      const { memoryStore } = await import('./features/pulse/agent/memory-store');
      await memoryStore.init();
      console.log('[Main] Memory store initialized');

      // Lazy load Topic Agent
      const { topicAgent } = await import('./features/topic/topic-agent');
      void topicAgent; // Instantiate
      console.log('[Main] Topic Agent initialized');

      const { checkAndGenerateBriefing } = await import('./scheduler');
      checkAndGenerateBriefing().catch(err => console.error('[Main] Scheduler error:', err));
    } catch (err) {
      console.error('[Main] Vector storage or Agent init failed:', err);
    }

    // Notify Frontend: Agents Ready (Unblur, Input unlock)
    setAppLifecycleState('READY');

    setupScreenCapture();
    console.log('[Main] Screen capture setup');

    try {

      const autoStart = getSetting('auto_start_recording');
      if (autoStart === 'true') {
        startRecording();
      }
    } catch (err) { console.error(err); }

    // Initialize event subscribers BEFORE starting async jobs to prevent race conditions
    setupVideoSubscribers();
    startAnalysisJob();

    setupTray(() => win);

    // @ts-ignore

    // Type-safe event subscription
    eventBus.subscribe('recording:state-changed', ({ isRecording }) => {
      if (win && !win.isDestroyed()) {
        updateTrayMenu(() => win, isRecording);
        win.webContents.send('recording-state-changed', isRecording);
      }
    });

    // @ts-ignore
    eventBus.subscribe('command:toggle-recording', () => {
      if (getIsRecording()) {
        stopRecording();
      } else {
        startRecording();
      }
    });

    setInterval(() => {
      const settings = getReminderSettings();
      const notificationType = checkReminders(new Date(), settings);
      if (notificationType) sendNotification(notificationType);
    }, 60 * 1000);

    setTimeout(() => {
      const retention = getRetentionSettings().storage_retention_days;
      cleanupOldSnapshots(retention);
    }, 10000);

    if (!VITE_DEV_SERVER_URL) {
      autoUpdater.checkForUpdatesAndNotify();
    }

    autoUpdater.on('update-available', () => {
      dialog.showMessageBox(win!, { type: 'info', title: 'Update Available', message: 'Downloading...' });
    });

    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox(win!, {
        type: 'info', title: 'Update Ready', message: 'Restart to update.', buttons: ['Restart']
      }).then((rv) => {
        if (rv.response === 0) autoUpdater.quitAndInstall();
      });
    });

    // @ts-ignore
    // Type-safe error handling
    eventBus.subscribe('capture:error', ({ title, message }) => {
      win?.webContents.send('capture-error', { title, message });

      dialog.showErrorBox(title, message);
    });

    createVideoGenerationWindow();
    console.log('[Main] Video generation service started');

    // === MEMORY LEAK DEBUGGING ===
    setInterval(() => {
      const mem = process.memoryUsage();
      const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

      // Calculate total app memory (all Electron processes)
      let totalAppMemory = mem.rss;
      try {
        const appMetrics = app.getAppMetrics();
        totalAppMemory = appMetrics.reduce((sum, proc) => sum + (proc.memory.workingSetSize * 1024), 0);
      } catch {
        // Fallback to main process RSS
      }

      console.log('--- Memory Check ---');
      console.log(`Main Process RSS: ${formatMB(mem.rss)}`);
      console.log(`Total App Memory: ${formatMB(totalAppMemory)} (All Processes)`);
      console.log(`Heap Used: ${formatMB(mem.heapUsed)} (JS Objects)`);
      console.log(`External: ${formatMB(mem.external)} (Buffers/C++ objects bound to JS)`);

      // Use total app memory for threshold (consistent with capture.service.ts)
      const totalAppMemoryMB = totalAppMemory / 1024 / 1024;
      if (totalAppMemoryMB > 500) {
        console.warn(`⚠️ HIGH MEMORY USAGE DETECTED (Total: ${totalAppMemoryMB.toFixed(0)}MB)`);
      }
    }, 10000); // Check every 10s

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
