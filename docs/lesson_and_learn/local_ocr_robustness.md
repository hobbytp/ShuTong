# Lesson Learned: Robustness in Local AI (OCR)

## Context
We implemented local offline OCR using **PaddleOCR** (via `@paddlejs-models/ocr` with WebGL acceleration) to complement the Cloud LLM OCR. While local execution saves costs and works offline, it introduces instability risks (crashes, hangs, memory leaks) that cloud APIs abstract away.

### OCR Engine Options
| Engine | Pros | Cons |
|--------|------|------|
| **PaddleOCR** | Fast WebGL inference, good Chinese support | Requires WebGL, larger model download |
| **Tesseract.js** | Pure JS, no GPU needed | Slower, less accurate on Chinese |
| **Cloud LLM** | Best quality, no local resources | Costs money, requires network |

## Problem 1: The "Hanging Worker"
During testing, we observed that OCR could occasionally hang indefinitely on corrupted or highly complex screenshots, causing the entire Analysis Service queue to stall.

## Solution: Defensive Programming

### 1. Strict Timeouts (The Guard)
We cannot trust external native libraries or heavy compute tasks to always return.
- **Pattern**: `Promise.race([ task, timeout ])`.
- **Implementation**:
  ```typescript
  const TIMEOUT_MS = 60000; // 60s for initial model download
  await Promise.race([
      paddleWindow.extract(image),
      new Promise((_, reject) => setTimeout(() => reject(new Error('OCR Timeout')), TIMEOUT_MS))
  ]);
  ```
- **Crucial Step**: If a timeout occurs, you **MUST** kill the worker (`terminate()`). Leaving a hung worker alive consumes memory and will likely fail the next request too.

### 2. Circuit Breaker (The Fail-Safe)
If the local engine fails repeatedly (e.g., missing WebGL, system out of memory), retrying the same broken engine is futile and slows down the user.
- **Pattern**: Count consecutive failures. If `failures > threshold`, switch strategy.
- **Implementation**:
  - Track `consecutiveFailures`.
  - If `fail > 3`, log "Circuit Open".
  - **Auto-Switch**: `currentEngine = 'cloud'` (Fallback).
  - **Recovery**: Requires a "cool-down" period (5 min) or user intervention (restart) to reset.

### 3. Warmup / Preloading (The Head Start)
PaddleOCR requires ~10-17s to initialize on first run (model download + WebGL shader compilation). Without warmup, the first OCR request suffers this delay.

- **Solution**: Call `ocrService.warmup()` at app startup (after storage init).
- **Key Points**:
  - **Non-blocking**: Warmup runs in background, doesn't delay app launch.
  - **Conditional**: Only warms up if local OCR is enabled in settings.
  - **Fail-safe**: Warmup failures are logged but don't crash the app.

```typescript
// main.ts - after storage init
ocrService.warmup().catch(err => 
    console.warn('[Main] OCR warmup failed:', err)
);
```

## Problem 2: CSP Blocking Model Downloads
PaddleOCR downloads models from `https://paddlejs.bj.bcebos.com` at runtime. The Content Security Policy (CSP) must allow this.

### Solution: Correct CSP Configuration
```html
<meta http-equiv="Content-Security-Policy"
  content="... connect-src 'self' data: blob: https://paddle-model-ecology.bj.bcebos.com https://paddlejs.bj.bcebos.com;">
```

**Required CSP directives for PaddleOCR:**
- `script-src 'unsafe-inline' 'unsafe-eval'` - For WebGL shader compilation
- `connect-src data: blob: https://paddlejs.bj.bcebos.com` - For model downloads
- `img-src data: blob:` - For image processing

## Takeaway
When moving AI from Cloud to Local:
1.  **Assume Failure**: The user's hardware is unreliable.
2.  **Fail Fast**: Don't let a background enhancement feature (OCR) block the main application loop.
3.  **Fallback Gracefully**: If local AI breaks, the app should continue working (even if simpler) rather than crashing.
4.  **Warmup Early**: Initialize heavy resources at app startup, not on first use.
5.  **CSP Matters**: When using browser-based AI libs, ensure CSP allows required network requests.

## Problem 3: Wrong GPU Selected (Dual GPU Laptops)
On laptops with dual GPUs (Intel integrated + NVIDIA discrete), Chromium/Electron defaults to the integrated GPU to save power. This caused PaddleOCR to run at 1/10th the expected speed.

### Solution: Chromium Command Line Switches
Add GPU optimization flags in `main.ts` before `app.whenReady()`:

```typescript
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
```

**To verify which GPU is being used**, run in DevTools Console:
```javascript
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl');
const ext = gl.getExtension('WEBGL_debug_renderer_info');
console.log('GPU:', gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
```

## Performance Notes

### Before GPU Optimization (Intel UHD Graphics)
| Metric | Value |
|--------|-------|
| Initialization | ~17s |
| Inference time | 17-30s per image ❌ |

### After GPU Optimization (NVIDIA RTX 3050)
| Metric | Value |
|--------|-------|
| Initialization | ~9-10s |
| Inference time | **2-3s per image** ✅ |

**Result: 10x inference speed improvement!**

### Remaining Issue
- **WebGL pipeline stalls**: `performance warning: READ-usage buffer was read back without waiting on a fence`
- This is a PaddleJS internal issue, does not affect performance significantly.

