# Dayflow UI Architecture & Design System

> **Status**: Implemented / Stable
> **Theme**: Native Clarity (Dark/Zinc)
> **Stack**: React + Tailwind CSS + Electron

This document serves as the **Single Source of Truth** for UI development. Any future modifications must adhere to these architectural decisions to prevent regressions (e.g., layout jitter, missing scrollbars, clipped tooltips).

## 1. App Shell Architecture

The App Shell (`AppShell.tsx`) is the foundation. It manages the window decoration, navigation, and main content area.

### 1.1. Layout Structure (Flexbox Strategy)
The layout uses a column-direction flex container that fills the screen. Critical constraint rules:

```tsx
<div className="h-screen w-screen flex flex-col overflow-hidden ...">
    <!-- 1. Fixed TitleBar (out of flow or fixed height) -->
    <TitleBar />

    <!-- 2. Content Wrapper -->
    <!-- MUST have min-h-0 to prevent flex child overflow issues -->
    <div className="flex-1 flex pt-[40px] relative min-h-0">
        
        <!-- 3. Sidebar (Fixed Width) -->
        <Sidebar />

        <!-- 4. Main Content (Scrollable) -->
        <!-- overflow-auto here handles the scrolling -->
        <main className="flex-1 overflow-auto bg-zinc-950 relative">
           {children}
        </main>
    </div>
</div>
```

**Critical Rules**:
1.  **Root Overflow**: The root container must be `overflow-hidden` to prevent native window scrollbars.
2.  **Wrapper Constraints**: The flex wrapper must have `min-h-0` (or `min-height: 0`) to allow children to shrink/scroll correctly. Without this, the container expands to fit content, pushing UI off-screen.
3.  **Main Scroll**: Scrolling is handled *only* by the `<main>` element (`overflow-auto`).
4.  **Visual Overflow**: The wrapper `<div>` typically should NOT be `overflow-hidden` if we need sidebar popouts (unless using Portals). However, since we switched to Portals for tooltips, `overflow-hidden` on the wrapper is acceptable but `min-h-0` is mandatory.

### 1.2. TitleBar
*   **Position**: Fixed (`top-0`, `left-0`, `right-0`) or standard flow with high z-index.
*   **Drag Region**: Must implement `app-region: drag` via CSS class (`.titlebar-drag`) on the container, and `app-region: no-drag` on interactive buttons.
*   **Platform Specifics**:
    *   **macOS**: Left padding (~80px) for traffic lights.
    *   **Windows**: Custom SVG controls (Min/Max/Close) on the right.

## 2. Navigation Rail (`Sidebar.tsx`)

The Sidebar allows navigation while maintaining a "Sticky Footer" for settings.

### 2.1. Layout & Dimensions
*   **Width**: Fixed (e.g., `w-[64px]` or `w-[44px]`).
*   **Flex Strategy**:
    *   **Top List**: `flex-1 overflow-y-auto` (Scrolls if window is short).
    *   **Bottom Item (Settings)**: `flex-shrink-0 mt-auto` (Always visible, anchored to bottom).

### 2.2. Tooltips (Portal Strategy)
**Problem**: Tooltips inside a scrollable sidebar (`overflow-y-auto`) get clipped.
**Solution**: Use **Portals**.
*   Render tooltips into `document.body` (outside the React root hierarchy visually).
*   Position precisely using `getBoundingClientRect` on `mouseEnter`.
*   **Never** rely on relative positioning inside the Sidebar for "pop-out" elements.

### 2.3. Active States
*   **Visuals**: Use subtle backgrounds (`bg-zinc-800`) and text color changes (`text-indigo-400`).
*   **Stability**: Avoid changing `font-weight` (Bold/Medium) or adding borders (`ring-1`) on active states if it causes layout jitter. Prefer background/color changes only.

## 3. Design System (Styling)

### 3.1. Color Palette (Zinc/Dark)
*   **Background**: `bg-zinc-950` (Main), `bg-zinc-900` (Cards).
*   **Text**: `text-zinc-50` (Primary), `text-zinc-400` (Muted).
*   **Accent**: `text-indigo-400` (Active/Brand).

### 3.2. Scrollbars
Custom Webkit scrollbars are applied globally (`index.css`) to match the dark theme.
*   **Width**: 8px (Thin).
*   **Thumb**: `bg-zinc-800` (Rounded, with `zinc-950` border for padding effect).
*   **Track**: Transparent.

### 3.3. Typography
*   **Font**: Inter / San Francisco / Segoe UI.
*   **Smoothing**: Always use `antialiased` for better contrast on dark backgrounds.

## 4. Component Checklist (Maintenance)

When modifying UI, verify:
1.  [ ] **Vertical Resize**: Does the "Settings" icon stick to bottom? Does the list scroll?
2.  [ ] **Horizontal Overflow**: Is content legible?
3.  [ ] **Tooltips**: Are they visible over other content? (Use Portal).
4.  [ ] **Scrollbars**: Are they visible in standard views (Timeline, Journal) when content is long?

## 5. Known Pitfalls (Do Not Regress)
*   **Do not remove `min-h-0`** from the AppShell flex wrapper. This breaks scrolling.
*   **Do not use `overflow-hidden`** on the Sidebar container if using non-portal tooltips (though Portal is preferred now).
*   **Do not use `window.ipcRenderer` directly** in components without cleanup logic or type safety checks.
*   **Do not use dynamic borders** (`border-2` vs `border-0`) for state changes; use `box-shadow` or `ring` (carefully) or opacity.

---
*Created by Antigravity - 2025-12-19*
