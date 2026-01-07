import { app } from 'electron';

export interface Shutdownable {
    name: string;
    shutdown(): Promise<void>;
    priority: number; // Higher closes first (e.g. Stop Input > Stop DB)
}

/**
 * Priority Levels for Shutdown
 */
export const ShutdownPriority = {
    CRITICAL: 100, // Stop Ingress (IPC, Servers)
    HIGH: 80,      // Stop Active Work (Capture, Video)
    MEDIUM: 50,    // Persist State (Agents, Checkpoints)
    LOW: 20,       // Close Storage (DB, Vector)
    SYSTEM: 0      // Exit Process
};

class LifecycleManager {
    private services: Shutdownable[] = [];
    private isShuttingDown = false;
    private watchdogTimeoutMs = 10000; // 10s default

    /**
     * Register a service to be shut down gracefully.
     */
    register(service: Shutdownable) {
        this.services.push(service);
        // Keep sorted by priority DESC
        this.services.sort((a, b) => b.priority - a.priority);
        console.log(`[Lifecycle] Registered ${service.name} (P${service.priority})`);
    }

    /**
     * Start the graceful shutdown sequence.
     */
    async shutdown() {
        if (this.isShuttingDown) {
            console.warn('[Lifecycle] Shutdown already in progress. Ignoring.');
            return;
        }

        this.isShuttingDown = true;
        console.log('[Lifecycle] Starting graceful shutdown sequence...');

        // 1. Start Watchdog
        const watchdog = setTimeout(() => {
            console.error('[Lifecycle] 🚨 SHUTDOWN TIMEOUT (Watchdog). Forcing exit.');
            app.exit(1);
        }, this.watchdogTimeoutMs);

        try {
            // 2. Execute shutdown for each service
            for (const service of this.services) {
                console.log(`[Lifecycle] Stopping ${service.name}...`);
                try {
                    // Bulkhead: One failure doesn't stop the rest
                    await service.shutdown();
                    console.log(`[Lifecycle] ✅ ${service.name} stopped.`);
                } catch (err) {
                    console.error(`[Lifecycle] ❌ Failed to stop ${service.name}:`, err);
                }
            }

            console.log('[Lifecycle] All services stopped. Exiting.');
            clearTimeout(watchdog);
            app.exit(0);

        } catch (fatalError) {
            console.error('[Lifecycle] Fatal error during shutdown orchestration:', fatalError);
            app.exit(1);
        }
    }
}

export const lifecycleManager = new LifecycleManager();
