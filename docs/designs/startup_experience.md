# Startup Experience Design: Organic Unfolding

## 1. Overview
The goal of the Startup Experience redesign is to eliminate the traditional "Loading..." screen and replace it with an "Organic Unfolding" metaphor. The application should feel like it wakes up and materializes on the desktop, rather than launching a window and filling it with content.

## 2. Architecture

### 2.1 State Machine
We introduced a strictly synchronized state machine between the Electron Main process and the React Renderer process.

Status | Description | Visual State | User Interaction
--- | --- | --- | ---
**BOOTING** | Electron window created, loading resources. | Transparent Window + Floating Breathing Logo. | None.
**HYDRATING** | React mounted, resolving storage/services. | Background fades in (Transparent -> Dark). Sidebar slides in. | Blocked (Cursor wait).
**READY** | All systems initialized. | Fully visible UI. Logo fades out. | Enabled.

### 2.2 Pull-Based Synchronization
To solve the race condition where `READY` events were sent before the UI mounted:
1.  **Main Process**: maintains `appLifecycleState`.
2.  **Renderer (React)**:
    *   Subscribes to `app-lifecycle` broadcasts.
    *   **Crucially**, invokes `get-app-lifecycle` immediately on mount to fetch the *current* state.

### 2.3 Transparent Window Splashing
Instead of a separate Splash Window (which adds complexity and window management overhead), we use a single **Transparent Main Window**.
*   **Electron**: `transparent: true`, `show: false` (initially).
*   **HTML**: Body background is transparent. Static HTML renders the Logo.
*   **React**: Hydrates into the same window. The `AppShell` gradually fades in its background color, effectively "filling" the transparent window behind the content.

## 3. Visual Design
*   **Floating Logo**: No window borders or background during boot.
*   **Glow Effect**: CSS-based radial gradients simulating a breathing light.
*   **Typography**: Clean, monospaced "INITIALIZING SYSTEM" text.

## 4. Technical Constraints
*   **Transparency**: Requires `backgroundColor` to be removed in Electron config.
*   **Assets**: Must use bundled assets (imports) rather than absolute paths to work in production `file://` protocol.
