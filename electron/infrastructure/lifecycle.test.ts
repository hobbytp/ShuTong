
import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lifecycleManager, Shutdownable } from './lifecycle';

// Mock Electron app
vi.mock('electron', () => ({
    app: {
        exit: vi.fn()
    }
}));

describe('LifecycleManager', () => {
    beforeEach(() => {
        // Reset services (private field access for testing)
        (lifecycleManager as any).services = [];
        (lifecycleManager as any).isShuttingDown = false;
        vi.clearAllMocks();
    });

    it('should register services and sort by priority', () => {
        const lowPriority: Shutdownable = { name: 'Low', priority: 10, shutdown: vi.fn() };
        const highPriority: Shutdownable = { name: 'High', priority: 100, shutdown: vi.fn() };

        lifecycleManager.register(lowPriority);
        lifecycleManager.register(highPriority);

        const services = (lifecycleManager as any).services;
        expect(services[0].name).toBe('High');
        expect(services[1].name).toBe('Low');
    });

    it('should execute shutdown in order', async () => {
        const order: string[] = [];
        const service1: Shutdownable = {
            name: 'Service1',
            priority: 10,
            shutdown: async () => { order.push('Service1'); }
        };
        const service2: Shutdownable = {
            name: 'Service2',
            priority: 20,
            shutdown: async () => { order.push('Service2'); }
        };

        lifecycleManager.register(service1);
        lifecycleManager.register(service2);

        await lifecycleManager.shutdown();

        expect(order).toEqual(['Service2', 'Service1']);
        expect(app.exit).toHaveBeenCalledWith(0);
    });

    it('should handle service errors gracefully (bulkheading)', async () => {
        const failingService: Shutdownable = {
            name: 'Failing',
            priority: 50,
            shutdown: async () => { throw new Error('Boom'); }
        };
        const workingService: Shutdownable = {
            name: 'Working',
            priority: 10,
            shutdown: vi.fn()
        };

        lifecycleManager.register(failingService);
        lifecycleManager.register(workingService);

        await lifecycleManager.shutdown();

        expect(workingService.shutdown).toHaveBeenCalled();
        expect(app.exit).toHaveBeenCalledWith(0);
    });

    it('should prevent double shutdown', async () => {
        const service: Shutdownable = { name: 'S', priority: 1, shutdown: vi.fn() };
        lifecycleManager.register(service);

        // Call twice
        const p1 = lifecycleManager.shutdown();
        const p2 = lifecycleManager.shutdown();

        await Promise.all([p1, p2]);

        expect(service.shutdown).toHaveBeenCalledTimes(1);
    });
});
