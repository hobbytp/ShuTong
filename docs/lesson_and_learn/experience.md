# Implementation Experience: Timeline Enhancements (OCR & Segmentation)

## 1. Overview
This document summarizes the challenges, bugs, and lessons learned during the implementation of Semantic Segmentation (Phase 1) and OCR Integration (Phase 2) for ShuTong.

## 2. Issues & Resolutions

### 🔴 Critical Logic Errors (P0)
*   **Disconnected Logic**: In Phase 2, the `extractTextBatch` method was called, and results were stored in a map, but this map **was never used**. The OCR text was effectively discarded before being sent to the LLM.
    *   *Fix*: Added logic to prepend `[OCR Context]` to the first observation's text field in `analysis.service.ts`.
*   **Undefined Variable**: The variable `prompt` was used in `ocr.service.ts` but was never defined.
    *   *Fix*: Defined a constant `OCR_PROMPT` with bilingual instructions.

### 🟠 Robustness & Stability (P1)
*   **Missing File Validation**: The OCR service attempted to upload files without checking if they existed, risking crashes on race conditions (e.g., file deleted by cleanup).
    *   *Fix*: Added `fs.existsSync()` checks.
*   **API Rate Limiting**: Sending 3 images simultaneously via `Promise.all` caused HTTP 429 (Too Many Requests) errors with some providers.
    *   *Fix*: Implemented sequential processing with a 500ms delay between requests.

### 🟡 Context & Data Quality (P2)
*   **Naive Truncation**: Initially, we joined all 3 OCR results and then sliced the first 2000 chars. This often meant the 3rd image was completely cut off if the first one was verbose.
    *   *Fix*: Implemented **per-image truncation** (800 chars each) to ensure diversity of context.
*   **Ambiguous Source**: The LLM didn't know which text came from which image.
    *   *Fix*: Added filenames: `[Image: screen_01.png] ...text...`.

### 🔵 Configuration (P3)
*   **Static Singleton**: `OCRService` read the `ocr_enabled` setting only once at startup. Changing settings required a full app restart.
    *   *Fix*: Modified `isEnabled()` to check the storage value dynamically at runtime.

---

## 3. Implementation Experience: Smart Capture (Smart OCR Keyframe)

### 3.1 Challenges in State Management
*   **Test Isolation**: The capture logic is highly stateful (`pendingFrame`, `lastWindowId`, `windowEnterTime`). Unit tests initially failed because state leaked between tests.
    *   *Fix*: Created a dedicated `__test__resetCaptureState()` helper that strictly resets ALL state variables.
*   **Time Simulation**: Testing "dwell time" (waiting 1 second before saving) was tricky with `setInterval`.
    *   *Learned*: Using `vi.useFakeTimers()` combined with direct calls to `__test__captureFrame()` (bypassing the interval) gave the precise control needed for robust tests.

### 3.2 Logic Evolution
*   **Idle vs. Input**: Initially, we planned to hook into OS-level keyboard events for "Checkpoint" frames. We realized `powerMonitor.getSystemIdleTime()` is a sufficient proxy: if idle time is low (< 30s), the user *must* be inputting. This saved us from adding complex native dependencies.
*   **The "Buffer" Concept**: Implementing the `pendingFrame` buffer was crucial. It allows us to "change our mind" about a frame. If the user quickly switches away, we discard it. If they stay, we commit it. This "delayed decision" pattern significantly reduced noise.

---

## 4. Lessons Learned

### 4.1 LLM Context Management
*   **Don't Concatenate Blindly**: When combining multiple data sources (e.g., 3 screenshots), always allocate a specific token budget (character limit) to *each* source. A single verbose source should not starve the others.
*   **Label Everything**: LLMs need metadata. Just dumping text is confusing. Labeling it `[OCR Context]` vs `[Visual Analysis]` significantly improves the model's ability to distinguish between "what it sees" and "what it reads".

### 4.2 System Reliability
*   **Always Self-Review**: The critical "Disconnected Logic" bug was found only because we performed a dedicated "Code Review" step where we simulated the data flow mentally. **Unit tests or mental walkthroughs are non-negotiable**.
*   **Graceful Degradation**: Features like OCR are "nice to have". If the API fails or the file is missing, the main feature (Timeline Analysis) must continue working. Our `try-catch` blocks in `analysis.service.ts` ensure this resilience.

### 4.3 Config Management
*   **Dynamic vs Static**: In long-running background processes (like Electron services), avoid caching configuration values in class properties unless performance is critical. Always checking the source of truth (Store/DB) enables a better user experience (instant toggles).

## 5. Conclusion
The implementation is now robust. The shift from "writing code" to "reviewing flow" was the turning point that saved the feature from being broken on release. Future implementations will prioritize **end-to-end data flow verification** earlier in the process.
