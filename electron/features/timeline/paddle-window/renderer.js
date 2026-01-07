console.log('[PaddleWorker] renderer.js executing...');
const { ipcRenderer } = require('electron');

// Declare ocr at module scope so it's accessible to all functions
let ocr;
try {
    console.log('[PaddleWorker] Requiring @paddlejs-models/ocr...');
    ocr = require('@paddlejs-models/ocr');
    console.log('[PaddleWorker] @paddlejs-models/ocr loaded.');
} catch (e) {
    console.error('[PaddleWorker] Failed to load dependencies:', e);
    throw e;
}


// P1 Fix: Global error handler for WebGL context loss
window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (msg.includes('webgl context is lost') || msg.includes('CONTEXT_LOST_WEBGL')) {
        console.error('[PaddleWorker] CRITICAL: WebGL Context Lost detected per global listener.');
        log('CRITICAL: WebGL Context Lost!');
        // Notify main process to restart this worker
        ipcRenderer.send('paddle-error', { message: 'WEBGL_CONTEXT_LOST', requestId: 'system' });
    }
});

console.log('[PaddleWorker] Renderer process started.');

const STATE = {
    isInit: false,
    initPromise: null,
    lastActivity: Date.now(),
    hasSignaledReady: false  // P0 Fix: Track if ready signal was sent
};

const statusDiv = document.getElementById('status');
const logsDiv = document.getElementById('logs');

function log(msg) {
    const ts = new Date().toISOString().split('T')[1].slice(0, -1);
    console.log(`[PaddleWorker ${ts}] ${msg}`);
    if (logsDiv) logsDiv.innerText = `[${ts}] ${msg}`;
    if (statusDiv) statusDiv.innerText = msg;
}

async function initialize() {
    if (STATE.isInit) return;

    if (STATE.initPromise) {
        return STATE.initPromise;
    }

    log('Initializing PaddleOCR model...');
    STATE.initPromise = (async () => {
        try {
            // P1: Check WebGL availability before model load
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) {
                throw new Error('WebGL not available - PaddleOCR requires GPU acceleration');
            }
            log('WebGL available, starting model load...');
            const initStart = performance.now();
            await ocr.init();
            const initDuration = Math.round(performance.now() - initStart);
            STATE.isInit = true;
            log(`PaddleOCR Initialized (WebGL) in ${initDuration}ms`);

            // P0 Fix: Send ready signal AFTER model is loaded
            if (!STATE.hasSignaledReady) {
                ipcRenderer.send('paddle-ready');
                STATE.hasSignaledReady = true;
                log('Ready signal sent to main process (model loaded).');
            }
        } catch (err) {
            log('Failed to initialize PaddleOCR: ' + err.message);
            STATE.initPromise = null; // Allow retry
            throw err;
        }
    })();

    return STATE.initPromise;
}

// Event-based IPC pattern
ipcRenderer.on('ocr-request', async (event, { imagePath, requestId }) => {
    STATE.lastActivity = Date.now();
    try {
        await initialize();

        log(`Processing: ${imagePath} (req: ${requestId})`);
        const imgElement = document.getElementById('target-image');

        // Load image into DOM element to let browser handle format decoding
        await new Promise((resolve, reject) => {
            imgElement.onload = () => resolve();
            imgElement.onerror = (e) => reject(new Error('Failed to load image source'));
            imgElement.src = `file://${imagePath}`;
        });

        // Measure inference duration separately
        const inferenceStart = performance.now();
        const res = await ocr.recognize(imgElement);
        const inferenceDuration = Math.round(performance.now() - inferenceStart);

        // Detailed logging for debugging OCR quality
        log(`Success. Text: ${res.text?.length || 0} chars, Inference: ${inferenceDuration}ms`);

        const resultPayload = {
            text: res.text,
            points: res.points,
            confidence: 1.0,
            requestId, // Include for validation
            inferenceDurationMs: inferenceDuration
        };

        // Send success back using the standard IPC channel expected by Main
        ipcRenderer.send('paddle-result', resultPayload);

    } catch (err) {
        console.error(err);
        log('Error: ' + err.message);
        // Send error back with requestId
        ipcRenderer.send('paddle-error', { message: err.message, requestId });
    }
});

log('PaddleWorker listeners registered.');

// P0 Fix: Removed premature paddle-ready signal.
// Ready signal is now sent AFTER ocr.init() completes in initialize().
// This ensures main process waits for model to load before sending requests.

// Trigger early initialization to start model download in background
initialize().catch(err => {
    log('Background init failed (will retry on first request): ' + err.message);
});

