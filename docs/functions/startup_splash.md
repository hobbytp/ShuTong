# Function: Startup Splash

## 1. Feature Description
The Startup Splash is the first visual element users see when launching ShuTong. It provides immediate feedback that the application is launching and masks the initialization time of the underlying AI services and database connections.

## 2. Key Capabilities
*   **Instant Feedback**: A static HTML splash screen appears milliseconds after the process starts, preventing the "White Screen of Death".
*   **Visual Status**: pulsating animations indicate the system is active and not frozen.
*   **Seamless Transition**: The splash screen does not abruptly close. Instead, it fades out while the main application UI fades in and slides into place.

## 3. User Experience
1.  **Launch**: User double-clicks ShuTong.
2.  **0-500ms**: A floating, glowing ShuTong logo appears on the desktop. The background is transparent.
3.  **500ms-2s**: The application initializes (database, vector store, AI agents).
4.  **2s+**: The application background darkens (materializes) and the sidebar slides in from the left. Input is enabled.

## 4. Configuration
*   **Development Mode**: A `DEV_STARTUP_DELAY` (default 0 or 2000ms) can be set in `main.ts` to debug the transition animations.
