## Current Implementation Problem

Current Timeline Architecture Analysis
Based on my code review, here is how the current "Timeline" works and where we can improve it.

1. Current Mechanism

**Capture & Segmentation**
* Capture: Screenshots are taken every 1s (configurable) and stored as JPEGs.
* Segmentation (The Weak Link): Currently, it uses a fixed-time batching strategy.
    * It accumulates screenshots until it hits a 60s target duration or a 5-minute gap.
    * Result: Your coherent 30-minute work session is blindly sliced into ~30 separate 1-minute cards. This is why it feels fragmented.

**Analysis (Surface Level)**
* Method: It sends each 60s batch of images to a VLM (Vision Language Model).
* Process:
    * Transcribe: "Describe what is happening in these images" (visual only).
    * Summarize: "Group these descriptions into a Title and Category".
* Flaw: It relies entirely on the model's visual interpretation. It does not actually "read" the text (no OCR), so it misses specific file names, complex code context, or subtle URL changes.

**Video Formation**
* Method: It spawns a hidden background window, loads the images into a canvas, and records the stream to a file.
* Granularity: One video per 60s card. This creates a library of tiny, disjointed clips rather than a watchable daily review.


**2. Proposed "Deep Insight" Architecture**
To get the "deeper insights" you want, we need to move from Time-Based to Content-Based processing.

**A. Semantic Segmentation (The Fix)**
Instead of "every 60s", we implement **Event Detection** using a multi-signal approach:

1.  **Window Switch Events (Primary Signal):**
    *   Leverage the existing `window_switch` events (`from_app` -> `to_app`) as hard boundaries.
    *   *Implementation:* Use `capture-guard.ts` event logs to slice the timeline precisely when the active application changes.

2.  **Context Switch (Secondary Signal):**
    *   **Activity Context Layer:** "VS Code" is too broad. We need "VS Code - Project A".
    *   *Title Parsing:* Extract context from window titles (e.g., `main.ts - ShuTong - VS Code` -> Project: `ShuTong`).
    *   *Domain Analysis:* For browsers, parse `stackoverflow.com` (Research) vs `bilibili.com` (Leisure).

**B. Deep Mining (The "Insight")**
We need to extract Structured Data to answer "What specifically was I doing?".

1.  **OCR Layer (PaddleOCR):**
    *   *Choice:* **PaddleOCR** (via Python backend) is recommended for its offline capability and superior mixed Chinese/English support.
    *   *Strategy:*
        *   **Lightweight:** Scan window titles and active element text constantly.
        *   **Deep Scan:** Trigger full-screen OCR only on unique keyframes (deduped) to save resources.

2.  **Entity Extraction & Clustering:**
    *   Ask LLM to extract JSON entities: `CurrentProject`, `ActiveFile`, `ActivityType` (Coding, Reading, Meeting).
    *   **Topic Clustering:** Group disjointed cards (e.g., 10 mins Coding, 5 mins Google, 10 mins Coding) into a single "Session: Implementing Feature X".

**C. Precise Dwell Time Analysis**
To accurately measure time spent on specific tasks (as requested):

*   **Logic:** `Dwell Time = Σ (Timestamp_Next_Frame - Timestamp_Current_Frame)`
*   **Refinement:**
    *   Use `dedup` logs: If 10 frames are skipped because of "Similar Frame", that is 10s of *pure focus* on that specific content.
    *   Filter "Initial Idle": Exclude time where the user is idle > 30s (already captured by `smart_guard`).
*   **Result:** Exact accounting like "Reading Paper X: 14m 20s", "Writing Code: 32m 10s".

**D. Video Formation 2.0**
*   **Granularity:** Video clips should align with **Sessions** (e.g., one 30-min video for the whole coding session), not arbitrary 60s chunks.
*   **Playback:** Allow skipping "Idle/Static" segments during playback for a timelapse effect.

**E. Summary of Technologies**
*   **Segmentation:** `window_switch` events + Title Parser.
*   **OCR:** PaddleOCR (Python Pulse Agent).
*   **Analysis:** LLM (JSON Extraction).

Next Steps

I recommend we start with Phase 1: Semantic Segmentation & OCR. This builds the foundation for deep insights. Shall I proceed with designing this?