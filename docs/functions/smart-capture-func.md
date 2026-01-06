# Smart Capture (Smart OCR Keyframe Strategy)

## Overview

Smart Capture is an intelligent screen recording strategy designed to capture the most meaningful moments of your work while ignoring redundant information. It ensures that **ShuTong** remembers what you were doing without filling your hard drive with duplicate screenshots or wasting AI processing power.

## How It Works

Instead of blindly taking a screenshot every second, Smart Capture analyzes your screen and activity to decide when to save a "Keyframe".

### The 4 Types of Keyframes

1.  **Onset Keyframe ("The Start")**
    *   **When**: You switch to a new window or the screen changes significantly.
    *   **Why**: Captures the beginning of a new context or action.
    *   **Example**: You open your email client.

2.  **Exit Keyframe ("The Result")**
    *   **When**: You switch away from a window you've been working in for a while (> 1 second).
    *   **Why**: Captures the *final state* of your work before you moved on. This is often the most important frame (e.g., the completed email before hitting send).
    *   **Example**: You finish typing an email and press Alt-Tab to switch to your browser. The system saves the completed email draft.

3.  **Checkpoint Keyframe ("The Progress")**
    *   **When**: You stay in the same window for a long time (> 30 seconds) and are actively working (typing/clicking).
    *   **Why**: Ensures that long sessions (like writing a document or coding) have intermediate progress saved, so you don't lose context if the system crashes or you work for hours without switching windows.
    *   **Example**: You are writing a long report in Word for 10 minutes. The system saves a snapshot every 30 seconds to track your progress.

4.  **Pending Frame ("The Buffer")**
    *   **What**: If the screen changes only slightly (e.g., a blinking cursor), the system holds this frame in memory but doesn't save it yet. It waits to see if it becomes an *Exit* or *Checkpoint* frame later.

## Benefits

*   **Better Search**: You can find the *final* version of your documents/emails because the system prioritizes "Exit" frames.
*   **Less Storage**: "Pending" frames that don't turn into meaningful moments are discarded, saving disk space.
*   **Smarter AI**: The AI analyzes fewer, higher-quality images, leading to better summaries and timeline insights.
*   **Noise Reduction**: Rapidly switching windows (Alt-Tab) within 1 second doesn't clutter your timeline.

## Configuration

Smart Capture works automatically. However, you can tweak settings in `config.yaml` or the Settings UI (if exposed):

*   **Interval**: How often to check for screen changes (Default: 1s).
*   **Dedup Similarity**: Sensitivity for detecting "similar" frames (Default: 0.05).
