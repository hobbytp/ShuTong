import { execSync } from 'child_process';
import os from 'os';

const platform = os.platform();

/**
 * Stop running application processes based on platform.
 */
function stopApp() {
    console.log(`[Stop] Target platform: ${platform}`);

    try {
        if (platform === 'win32') {
            // Windows
            execSync('taskkill /F /IM ShuTong.exe /T 2>nul || exit 0', { shell: 'cmd.exe' });
            execSync('taskkill /F /IM electron.exe /T 2>nul || exit 0', { shell: 'cmd.exe' });
        } else {
            // macOS / Linux
            execSync('pkill -f ShuTong || true');
            execSync('pkill -f electron || true');
        }
        console.log('[Stop] Stop commands executed.');
    } catch (err) {
        console.error('[Stop] Error executing stop command:', err);
    }
}

stopApp();
