# Timeline Features: Semantic Segmentation & OCR

This document details the new "Event-Based Batching" and "OCR Context" features available in the Timeline module.

## 1. Feature Overview

### 1.1 Semantic Segmentation (Event-Based Batching)
Previously, ShuTong grouped your activity into fixed 5-minute chunks. This often led to fragmented or mixed timeline cards (e.g., a card containing 2 minutes of coding and 3 minutes of YouTube).

**Now**, ShuTong intelligently groups activity based on **context**:
-   **Smart Grouping**: A timeline card represents a single logical task (e.g., "Working on `server.ts` in VS Code").
-   **Auto-Split**: Switching apps or significantly changing context (e.g., from VS Code to Chrome) automatically ends the current card and starts a new one.
-   **Gap Handling**: Small gaps (< 1 min) are ignored to keep flow; large gaps trigger a break.

### 1.2 OCR Enhancement
ShuTong now uses Optical Character Recognition (OCR) to "read" the text on your screen.
-   **Deep Understanding**: The AI can read error logs, code snippets, and document text that might be too small for visual analysis alone.
-   **Context Injection**: This text is fed to the AI summarizer, resulting in much more specific and accurate Timeline Cards.

---

## 2. Configuration

### 2.1 Enabling/Disabling OCR
OCR is enabled by default but can be toggled:
-   **Settings UI**: Go to `Settings > Recording > Analysis`.
-   **Local Storage**: The setting key is `ocr_enabled`.
    -   Set to `true` (default) to enable.
    -   Set to `false` to disable.
    -   *Note*: The system checks this setting dynamically; no restart required.

### 2.2 LLM Configuration
These features rely on specific roles in `llm_config.json`:
-   **`SCREEN_ANALYZE`**: The Vision LLM that generates the Activity Card. Now receives OCR context.
-   **`OCR_SCANNER`**: The model used for extracting text from images.
    -   **Cloud (Default)**: `SiliconFlow/deepseek-ai/DeepSeek-OCR` (High accuracy).
    -   **Local (PaddleOCR)**: Uses `@paddlejs-models/ocr` with WebGL acceleration. Recommended for offline OCR with good Chinese/English support.
        -   **Warmup**: Model is preloaded at app startup when local OCR is enabled (~10s).
        -   **Timeout Protection**: Kills worker if processing > 60s.
        -   **Circuit Breaker**: Auto-switch to Cloud if local OCR fails 3 times consecutively.
    -   **Local (Tesseract)**: Alternative using `tesseract.js`. Slower, pure JavaScript, no GPU required.

---

## 3. Usage & Effects

### 3.1 What You Will See
-   **Timeline Cards**:
    -   **Titles**: More specific (e.g., *"Debugging Auth Error in auth.service.ts"* instead of *"Coding in VS Code"*).
    -   **Summaries**: Contain specific details quoted from the screen (e.g., error codes, function names).
    -   **Boundaries**: Cards align perfectly with when you started/stopped working on a specific task.

### 3.2 Performance Impact
-   **Latency**: Generating a card might take slightly longer (seconds) due to the extra OCR step.
-   **Cost**:
    -   **OCR**: We sample only 3 screenshots per batch to minimize API costs (Cloud) or CPU usage (Local).
    -   **Context Window**: OCR text is truncated (800 chars/image) to avoid exploding token usage.
-   **Network**: 
    -   **Cloud**: Requires internet access.
    -   **Local**: Fully offline capable (after initial language data download).
-   **Robustness**: System gracefully degrades. If OCR fails, it falls back to visual-only analysis.

---

## 4. Technical Limitations
-   **Max Batch Duration**: A single card cannot exceed **15 minutes**. Long sessions will be split into multiple 15-minute cards.
-   **OCR Sampling**: Since we only scan a sample (Start, Mid, End), text that appears transiently between samples might be missed.
-   **Rate Limiting**: To prevent CPU spikes or API errors, OCR requests have a 500ms delay between images.

---

## 5. Intelligent Session Merge

### 5.1 The Problem
Event-Based Batching can create many short, fragmented cards when you rapidly switch between applications (e.g., VS Code → Chrome → VS Code). This leads to a cluttered timeline.

### 5.2 The Solution: Session Merger
ShuTong now includes an **intelligent post-processing merge** step that consolidates related activity cards.

**How it works:**
1.  After regular analysis, `SessionMerger` scans recent cards.
2.  It identifies groups of cards that are **close in time** (< 2 min gap).
3.  It asks the AI: *"Do these activities belong to the same task?"*
4.  If yes, the AI generates a **merged summary**, and the old cards are replaced with a single, comprehensive card.

**Benefits:**
-   **Cleaner Timeline**: Fewer, more meaningful cards.
-   **Better Context**: Merged cards capture the full story of a task, including brief distractions.
-   **No Data Loss**: The underlying observations are preserved; only the summary layer is consolidated.

**Configuration:**
-   This feature runs automatically and has no separate toggle.
-   It uses the `TEXT_SUMMARY` LLM role, so ensure a capable model is assigned.

