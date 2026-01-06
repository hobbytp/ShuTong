# Lessons Learned: Smart Capture (Smart OCR Keyframe Strategy)

## 1. Overview

This document summarizes the specific challenges, design evolution, and technical hurdles encountered during the development of the **Smart Capture** feature (Buffer-Commit Protocol). It serves as a reference for future developers to avoid similar pitfalls.

## 2. Design Challenges & Solutions

### 2.1 The "Final State" Problem
*   **Issue**: Initially, the system only deduplicated frames. If simple deduplication was used, the *last* frame before a user switched windows (the "Exit Frame") was often discarded because it was "similar" to the previous frame. This meant the most complete version of a document or email was lost.
*   **Solution**: Introduced the **Buffer-Commit Protocol**. instead of discarding similar frames immediately, we buffer the latest one as a `pendingFrame`. When a window switch is detected, we "commit" this buffered frame as an **Exit Keyframe**.

### 2.2 The "Intermediate Progress" Problem
*   **Issue**: For long working sessions (e.g., coding for 30 minutes in one window), "Exit Keyframes" weren't enough. If the user didn't switch windows, no new keyframes were saved, leading to data loss if the app crashed or just poor timeline granularity.
*   **Solution**: Introduced **Checkpoint Keyframes**. We added a timer to force-commit the `pendingFrame` every 30 seconds, *but only if* the user is actively creating input (typing/mouse).

### 2.3 Noise from Rapid Switching (Alt-Tab)
*   **Issue**: Users often quickly Alt-Tab through windows to find something. This generated many useless "Exit Keyframes" for windows that were visible for only fractions of a second.
*   **Solution**: Implemented a **Minimum Dwell Time** (1000ms). An Exit Keyframe is only saved if the user stayed in that window for at least 1 second. Otherwise, the buffered frame is discarded.

### 2.4 Complexity of Input Detection
*   **Issue**: To detect "active work" for Checkpoints, we initially considered hooking into low-level OS keyboard/mouse events. This would have introduced native dependencies, complexity, and potential privacy concerns.
*   **Solution**: **Proxy via Idle Time**. We utilized Electron's built-in `powerMonitor.getSystemIdleTime()`.
    *   Logic: If `idleTime < 30s`, the user *must* have touched the input devices recently.
    *   Result: Zero extra dependencies, same effective outcome.

---

## 3. Code & Implementation Issues

### 3.1 State Management in Singleton Service
*   **Issue**: `capture.service.ts` is a long-running singleton with complex internal state (`pendingFrame`, `lastWindowId`, `windowEnterTime`, `lastCheckpointTime`).
*   **Risk**: If variables aren't reset correctly on window switches or recording stops, logic becomes unpredictable (e.g., attributing a frame to the wrong window).
*   **Solution**:
    *   Strict logic flow: **Commit -> Reset -> New**.
    *   Explicit `resetLastFrame()` calls when window ID changes.

### 3.2 Unused Data Logic (Legacy)
*   **Issue**: During the refactor, we found code that batched OCR requests but stored them in a variable that was never read (orphaned logic).
*   **Lesson**: Always trace data flow end-to-end. "Writing" code isn't enough; "consuming" it is what matters.

---

## 4. Testing Challenges & Solutions

### 4.1 Test Isolation (The "Bleeding State" Bug)
*   **Issue**: Unit tests for `capture.service` were failing randomly.
*   **Root Cause**: The module's top-level variables (`pendingFrame`, etc.) retained values between tests. A test simulating a "window switch" would leave the service in a state that confused the next test expecting a "clean slate".
*   **Solution**: Created a dedicated `__test__resetCaptureState()` function exported *only* for testing. Called it in `beforeEach` and `afterEach` to force a hard reset of all internal state.

### 4.2 Mocking Time-Dependent Logic
*   **Issue**: Testing "wait 1 second dwell time" or "wait 30 seconds checkpoint" is slow and flaky with real timers.
*   **Solution**: Heavy use of **Vitest Fake Timers** (`vi.useFakeTimers`, `vi.advanceTimersByTime`).
    *   *Critical Detail*: We had to manipulate time *between* calls to `captureFrame`. Since `captureFrame` captures `Date.now()` internally, advancing the fake timer correctly simulated the passage of time for the logic checks.

### 4.3 Mocking Modules (Hoisting)
*   **Issue**: We needed to mock `capture-guard`'s `getIdleTime` export to return different values for different tests (active vs. idle). Using `vi.doMock` inside tests failed because the module was already imported/cached.
*   **Solution**: Used **`vi.hoisted`** to create a mutable mock object at the top level, then referenced this mock in `vi.mock()`.
    *   *Pattern*:
        ```typescript
        const mocks = vi.hoisted(() => ({ getIdleTime: vi.fn() }));
        vi.mock('./module', () => ({ getIdleTime: mocks.getIdleTime }));
        // In test:
        mocks.getIdleTime.mockReturnValue(5);
        ```

### 4.4 Simulating "Similar" Frames
*   **Issue**: We needed to test the *sequence* of "Onset -> Similar (Buffer) -> Limit (Checkpoint)".
*   **Solution**: Orchestrated the mock `checkFrameSimilarity` to return `true` (similar) or `false` (different) in a specific sequence to drive the state machine through the exact transitions we wanted to verify.
