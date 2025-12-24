import { app } from 'electron';
import path from 'path';

export interface DeepLinkActions {
    onStartRecording: () => void;
    onStopRecording: () => void;
}

export function setupDeepLinks(actions: DeepLinkActions) {
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('shutong', process.execPath, [path.resolve(process.argv[1])])
        }
    } else {
        app.setAsDefaultProtocolClient('shutong');
    }

    // macOS Handler
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleUrl(url, actions);
    });

    // Windows/Linux Handler
    app.on('second-instance', (_event, argv) => {
        // Find the argument that looks like a url
        const url = argv.find(arg => arg.startsWith('shutong://'));
        if (url) {
            handleUrl(url, actions);
        }
    });

    // Initial launch on Windows can pass args directly to process.argv?
    // Electron's 'second-instance' covers the case where app is already running.
    // Use 'will-finish-launching' or similar for cold start if needed, 
    // but app.whenReady() in main usually suffices for basic setups.
}

function handleUrl(url: string, actions: DeepLinkActions) {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.endsWith('start-recording') || lowerUrl.includes('start-recording')) {
        actions.onStartRecording();
    } else if (lowerUrl.endsWith('stop-recording') || lowerUrl.includes('stop-recording')) {
        actions.onStopRecording();
    }
}
