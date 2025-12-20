# Modern UI Refactor: "Native Clarity" (Refined Engineering Plan)

界面设计主要使用Gemini 3 Pro，所以它推荐的是**Google Material Design 3**设计。


## 1. Vision & Goals
Move Dayflow to a **"Premium Native Desktop Experience"** that is not just visually pleasing but engineered for performance and platform capabilities.
*   **Visuals**: "Bento Grid" layouts, `zinc`/`slate` palette, `lucide-react` icons.
*   **Engineering**: Platform-aware shells, optimistic UI updates, and performance-conscious CSS.

## 2. Core Layout Architecture: The "Platform-Aware Shell"

We will implement a responsive App Shell that adapts to the OS architecture.

### 2.1. TitleBar Strategy (Crucial)
Instead of a single "overlay", we implement a bifurcated strategy based on `process.platform`.

*   **Common Behaviors**: Height ~32px, `app-region: drag`, Double-click to maximize.
*   **Deep Interaction**: All interactive elements (Search, Profile, Buttons) *must* have `app-region: no-drag`.

#### macOS (`titleBarStyle: 'hiddenInset'`)
*   **Controls**: Native "Traffic Lights" on the **Left**.
*   **Layout**: `padding-left: 80px` (avoid traffic lights). Title/Search centered or left-aligned after padding.
*   **Effect**: Sidebar extends to the top edge (Unified Window).

#### Windows (Custom Frameless)
*   **Controls**: **Right-aligned** custom SVG buttons (Minimize, Maximize/Restore, Close).
*   **Layout**: `padding-right: 140px` (reserve space for controls).
*   **Implementation**: These buttons communicate via IPC (`window-min`, `window-max`, `window-close`).

### 2.2. Navigation & Sidebar
*   **Sidebar**: A slim, persistent navigation rail.
    *   *Visuals*: `bg-zinc-950` with a *subtle* border-right.
    *   *Performance*: Avoid high-blur `backdrop-filter` on the entire sidebar to prevent GPU thrashing during resize/drag. Use `bg-opacity-95` instead.

## 3. The Dashboard (Responsive Bento Grid)

### 3.1. Layout Logic
Abandon hardcoded `grid-cols-4`. Use responsive CSS Grid with `auto-fit`:
```css
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem; /* p-6 equivalent */
}
```

### 3.2. Card Priority (Mobile/Small Window Support)
Cards will flow naturally.
*   **Top Tier (Full Width)**: Daily Summary / Focus Timer.
*   **Mid Tier (1 Col)**: Quick Actions, Stats.
*   **Low Tier (Auto)**: Recent Activity Log.

## 4. Performance & Data Strategy

### 4.1. "Optimistic" Timers
**Problem**: Sending `get-current-time` IPC every second kills the main thread.
**Solution**:
1.  **Backend**: Sends `activity_started_at` timestamp **once**.
2.  **Frontend**: React component uses `requestAnimationFrame` or `setInterval` to calculate `now - started_at` locally.
*   *Result*: 60fps smooth timer, zero IPC traffic for time updates.

### 4.2. Glassmorphism Constraint
*   **Rule**: heavily restricted usage.
*   **Where**: Only on modal overlays or sticky headers (if small).
*   **Main BG**: `bg-zinc-950` (Solid).
*   **Card BG**: `bg-zinc-900` (Solid).

## 5. Visual System (Shadcn/Zinc)

### 5.1. Color Palette
*   **Background**: `bg-zinc-950`.
*   **Foreground**: `text-zinc-50`.
*   **Muted**: `text-zinc-400`.
*   **Border**: `border-zinc-800`.

### 5.2. Typography (Platform-Optimized)
Tailwind Config update to ensure crisp rendering on Windows:
```javascript
fontFamily: {
  sans: ['Inter', 'Segoe UI', 'San Francisco', 'system-ui', 'sans-serif'],
}
```

## 6. Implementation Stages

### Phase 1: Foundation
1.  **Dependencies**: Install `lucide-react`, `clsx`, `tailwind-merge`.
2.  **Tailwind Config**: Add fonts, colors, and `no-drag` utility classes.
3.  **UI Primitives**: Build `Card`, `Button` folders in `src/components/ui`.

### Phase 2: App Shell (The Hard Part)
1.  **Main Process**: Configure `BrowserWindow` with `frame: false` and `webPreferences: { preload: ... }`.
    *   Detect OS and pass `IS_MAC` / `IS_WIN` via preload.
2.  **TitleBar Component**: Create `TitleBar.tsx` with conditional rendering logic for Window Controls.
3.  **Layout Wrapper**: Update `App.tsx` to wrap pages in the new Shell.

### Phase 3: Dashboard & Logic
1.  **Home View**: Implement the Bento Grid.
2.  **Timer Logic**: Refactor timer to use client-side calculation.
