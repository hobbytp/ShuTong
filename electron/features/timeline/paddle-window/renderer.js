
const { ipcRenderer } = require('electron');
const ocr = require('@paddlejs-models/ocr');

console.log('[PaddleWorker] Renderer process started.');

const STATE = {
    isInit: false,
    initPromise: null,
    lastActivity: Date.now()
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
            await ocr.init();
            STATE.isInit = true;
            log('PaddleOCR Initialized (WebGL)');
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

// Signal to main process that renderer is ready
ipcRenderer.send('paddle-ready');
log('Ready signal sent to main process.');
