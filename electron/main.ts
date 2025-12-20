import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cancelMigration, commitMigration, getBootstrapConfig, PendingMigration, resolveUserDataPath, setPendingMigration } from './bootstrap'
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
import { getCardDetails, getReminderSettings, getRetentionSettings, getScreenshotsForCard, getTimelineCards, initStorage } from './storage'

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
      secure: true,
      supportFetchAPI: true,
      standard: true,
      stream: true, // Optimizes video streaming
      bypassCSP: true // Helps with CSP issues
    }
  }
]);

async function startApp() {
  try {
    console.log('[Main] App ready')
    initStorage()
    console.log('[Main] Storage initialized')
    setupScreenCapture()
    console.log('[Main] Screen capture setup')

    startAnalysisJob()
    console.log('[Main] Analysis job started')

    createWindow()
    console.log('[Main] Window created')

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

    ipcMain.handle('trigger-cleanup', async (_event, days) => {
      const count = await cleanupOldSnapshots(days);
      return count;
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

    // LLM Configuration
    ipcMain.handle('get-llm-config', () => getMergedLLMConfig());

    ipcMain.handle('set-llm-provider-config', (_, providerName, config) => {
      setLLMProviderConfig(providerName, config);
    });

    ipcMain.handle('set-role-config', (_, roleName, config) => {
      setRoleConfig(roleName, config);
    });

    // Recording Control handlers are registered in setupScreenCapture()

    // --- Raw Config Handlers ---
    ipcMain.handle('get-raw-llm-config', async () => {
      const { getRawLLMConfig } = await import('./config_manager');
      return getRawLLMConfig();
    });

    ipcMain.handle('save-raw-llm-config', async (_, content) => {
      const { saveRawLLMConfig } = await import('./config_manager');
      return saveRawLLMConfig(content);
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
        return { success: true, content }; // Return content to UI, don't save yet
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
    // ---------------------------

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

        // Simple "Hello" prompt
        await provider.generateContent({ prompt: 'Hello' });
        return { success: true, message: 'Connection successful!' };
      } catch (error: any) {
        console.error(`[Main] Connection test failed for ${providerName}:`, error);
        return { success: false, message: error.message || 'Connection failed' };
      }
    });

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

    ipcMain.handle('select-directory', async () => {
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Data Storage Location',
        message: 'All recordings, videos, and the database will be stored here. Requires restart.'
      });
      if (result.canceled) return null;

      const newPath = result.filePaths[0];

      // Use dynamic import to avoid circular dependency issues if any,
      // though top-level import is fine now. we use what we imported.
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
