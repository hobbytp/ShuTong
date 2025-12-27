/**
 * Unit tests for Capture Guard Module (Smart Capture Guard v2)
 * Tests power-aware capture and interval multiplier functionality
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const powerMonitorHandlers = new Map<string, () => void>();
const powerMonitorOn = vi.fn((event: string, handler: () => void) => {
    powerMonitorHandlers.set(event, handler);
});
const getSystemIdleTime = vi.fn(() => 0);

// Mock electron's powerMonitor
vi.mock('electron', () => ({
    powerMonitor: {
        on: powerMonitorOn,
        getSystemIdleTime
    }
}));

type CaptureGuardModule = typeof import('../../electron/features/capture/capture-guard');
let captureGuard: CaptureGuardModule;

function firePowerEvent(event: string) {
    const handler = powerMonitorHandlers.get(event);
    if (!handler) {
        throw new Error(`Missing powerMonitor handler for event: ${event}`);
    }
    handler();
}

describe('Capture Guard Module', () => {
    beforeEach(async () => {
        vi.resetModules();
        powerMonitorHandlers.clear();
        powerMonitorOn.mockClear();
        getSystemIdleTime.mockClear();
        getSystemIdleTime.mockImplementation(() => 0);

        captureGuard = await import('../../electron/features/capture/capture-guard');
        captureGuard.initCaptureGuard();

        // Reset settings to defaults before each test
        captureGuard.updateGuardSettings({
            idleThresholdSeconds: 30,
            windowSwitchDebounceMs: 2000,
            blacklistedApps: ['1Password', 'KeePass', 'Bitwarden', 'LastPass'],
            enableIdleDetection: true,
            enableLockDetection: true,
            enableBatteryMode: true,
            batteryModeIntervalMultiplier: 2.0,
            criticalBatteryThreshold: 20
        });
    });

    describe('Settings Management', () => {
        it('should update settings correctly', () => {
            captureGuard.updateGuardSettings({ idleThresholdSeconds: 60 });

            const settings = captureGuard.getGuardSettings();

            expect(settings.idleThresholdSeconds).toBe(60);
        });

        it('should preserve other settings when partial update', () => {
            captureGuard.updateGuardSettings({ idleThresholdSeconds: 60 });

            const settings = captureGuard.getGuardSettings();

            expect(settings.enableIdleDetection).toBe(true);
            expect(settings.blacklistedApps).toContain('1Password');
        });
    });

    describe('App Blacklisting', () => {
        it('should detect blacklisted apps (case insensitive)', () => {
            expect(captureGuard.isAppBlacklisted('1password')).toBe(true);
            expect(captureGuard.isAppBlacklisted('1Password')).toBe(true);
            expect(captureGuard.isAppBlacklisted('1PASSWORD')).toBe(true);
        });

        it('should detect blacklisted apps with .exe suffix', () => {
            expect(captureGuard.isAppBlacklisted('1password.exe')).toBe(true);
            expect(captureGuard.isAppBlacklisted('KeePass.exe')).toBe(true);
        });

        it('should not flag non-blacklisted apps', () => {
            expect(captureGuard.isAppBlacklisted('Chrome')).toBe(false);
            expect(captureGuard.isAppBlacklisted('VSCode')).toBe(false);
            expect(captureGuard.isAppBlacklisted('Notepad')).toBe(false);
        });

        it('should detect partial matches in app name', () => {
            // If app name contains blacklisted term
            expect(captureGuard.isAppBlacklisted('Bitwarden Desktop')).toBe(true);
        });
    });

    describe('shouldSkipCapture', () => {
        it('should skip for blacklisted apps', () => {
            const reason = captureGuard.shouldSkipCapture('1Password');

            expect(reason).toBe('blacklisted');
        });

        it('should not skip for normal apps', () => {
            const reason = captureGuard.shouldSkipCapture('Chrome');

            expect(reason).toBe(null);
        });
    });

    describe('Power-Aware Capture (v2)', () => {
        it('should register powerMonitor listeners on init', () => {
            const events = powerMonitorOn.mock.calls.map(call => call[0]);
            expect(events).toContain('on-battery');
            expect(events).toContain('on-ac');
            expect(events).toContain('lock-screen');
            expect(events).toContain('unlock-screen');
            expect(events).toContain('suspend');
            expect(events).toContain('resume');
        });

        describe('getIntervalMultiplier', () => {
            it('should return 1.0 when battery mode is disabled', () => {
                captureGuard.updateGuardSettings({ enableBatteryMode: false });

                const multiplier = captureGuard.getIntervalMultiplier();

                expect(multiplier).toBe(1.0);
            });

            it('should return 1.0 when on AC power', () => {
                // Default state is on AC power
                const multiplier = captureGuard.getIntervalMultiplier();

                expect(multiplier).toBe(1.0);
            });

            it('should return configured multiplier when on battery', () => {
                firePowerEvent('on-battery');

                expect(captureGuard.isOnBattery()).toBe(true);
                expect(captureGuard.getIntervalMultiplier()).toBe(2.0);
            });

            it('should return 1.0 after switching back to AC', () => {
                firePowerEvent('on-battery');
                expect(captureGuard.getIntervalMultiplier()).toBe(2.0);

                firePowerEvent('on-ac');
                expect(captureGuard.isOnBattery()).toBe(false);
                expect(captureGuard.getIntervalMultiplier()).toBe(1.0);
            });
        });

        describe('isOnBattery', () => {
            it('should return false initially (AC power)', () => {
                expect(captureGuard.isOnBattery()).toBe(false);
            });
        });

        describe('shouldPauseForLowBattery', () => {
            it('should return false when battery mode is disabled', () => {
                captureGuard.updateGuardSettings({ enableBatteryMode: false });

                expect(captureGuard.shouldPauseForLowBattery(10)).toBe(false);
            });

            it('should return false when on AC power regardless of percentage', () => {
                // Default state is AC power
                expect(captureGuard.shouldPauseForLowBattery(5)).toBe(false);
            });

            it('should return true when on battery and below critical threshold', () => {
                firePowerEvent('on-battery');
                expect(captureGuard.shouldPauseForLowBattery(19)).toBe(true);
            });

            it('should return false when on battery at or above critical threshold', () => {
                firePowerEvent('on-battery');
                expect(captureGuard.shouldPauseForLowBattery(20)).toBe(false);
                expect(captureGuard.shouldPauseForLowBattery(100)).toBe(false);
            });

            it('should respect criticalBatteryThreshold setting', () => {
                captureGuard.updateGuardSettings({ criticalBatteryThreshold: 30 });

                const settings = captureGuard.getGuardSettings();

                expect(settings.criticalBatteryThreshold).toBe(30);

                firePowerEvent('on-battery');
                expect(captureGuard.shouldPauseForLowBattery(29)).toBe(true);
                expect(captureGuard.shouldPauseForLowBattery(30)).toBe(false);
            });
        });

        describe('Battery Mode Settings', () => {
            it('should update battery mode multiplier', () => {
                captureGuard.updateGuardSettings({ batteryModeIntervalMultiplier: 3.0 });

                const settings = captureGuard.getGuardSettings();

                expect(settings.batteryModeIntervalMultiplier).toBe(3.0);

                firePowerEvent('on-battery');
                expect(captureGuard.getIntervalMultiplier()).toBe(3.0);
            });

            it('should update critical battery threshold', () => {
                captureGuard.updateGuardSettings({ criticalBatteryThreshold: 15 });

                const settings = captureGuard.getGuardSettings();

                expect(settings.criticalBatteryThreshold).toBe(15);
            });

            it('should toggle battery mode', () => {
                captureGuard.updateGuardSettings({ enableBatteryMode: false });

                expect(captureGuard.getGuardSettings().enableBatteryMode).toBe(false);

                captureGuard.updateGuardSettings({ enableBatteryMode: true });

                expect(captureGuard.getGuardSettings().enableBatteryMode).toBe(true);
            });
        });
    });

    describe('Guard Status Visibility (v2)', () => {
        beforeEach(() => {
            captureGuard.resetGuardStats();
        });

        describe('recordSkip', () => {
            it('should record skip with reason', () => {
                captureGuard.recordSkip('idle', 'TestApp');

                const stats = captureGuard.getGuardStats();
                expect(stats.totalSkips).toBe(1);
                expect(stats.lastSkipReason).toBe('idle');
                expect(stats.skipsByReason['idle']).toBe(1);
            });

            it('should accumulate multiple skips', () => {
                captureGuard.recordSkip('idle');
                captureGuard.recordSkip('idle');
                captureGuard.recordSkip('blacklisted', 'KeePass');

                const stats = captureGuard.getGuardStats();
                expect(stats.totalSkips).toBe(3);
                expect(stats.skipsByReason['idle']).toBe(2);
                expect(stats.skipsByReason['blacklisted']).toBe(1);
            });

            it('should not record null reason', () => {
                captureGuard.recordSkip(null);

                const stats = captureGuard.getGuardStats();
                expect(stats.totalSkips).toBe(0);
            });
        });

        describe('recordCapture', () => {
            it('should increment total captures', () => {
                captureGuard.recordCapture();
                captureGuard.recordCapture();

                const stats = captureGuard.getGuardStats();
                expect(stats.totalCaptures).toBe(2);
            });
        });

        describe('getSkipLog', () => {
            it('should return recent skip entries', () => {
                captureGuard.recordSkip('idle', 'App1');
                captureGuard.recordSkip('blacklisted', 'App2');

                const log = captureGuard.getSkipLog();
                expect(log.length).toBe(2);
                expect(log[0].reason).toBe('idle');
                expect(log[1].reason).toBe('blacklisted');
            });

            it('should respect limit parameter', () => {
                captureGuard.recordSkip('idle');
                captureGuard.recordSkip('idle');
                captureGuard.recordSkip('idle');

                const log = captureGuard.getSkipLog(2);
                expect(log.length).toBe(2);
            });
        });

        describe('resetGuardStats', () => {
            it('should clear all statistics', () => {
                captureGuard.recordSkip('idle');
                captureGuard.recordCapture();

                captureGuard.resetGuardStats();

                const stats = captureGuard.getGuardStats();
                expect(stats.totalCaptures).toBe(0);
                expect(stats.totalSkips).toBe(0);
                expect(captureGuard.getSkipLog().length).toBe(0);
            });
        });
    });

    describe('Whitelist Mode (v2)', () => {
        beforeEach(() => {
            captureGuard.updateGuardSettings({
                enableWhitelistMode: false,
                whitelistedApps: []
            });
        });

        describe('isAppWhitelisted', () => {
            it('should return false when whitelist is empty', () => {
                captureGuard.updateGuardSettings({ whitelistedApps: [] });
                expect(captureGuard.isAppWhitelisted('VSCode')).toBe(false);
            });

            it('should return true for whitelisted apps', () => {
                captureGuard.updateGuardSettings({ whitelistedApps: ['VSCode', 'Chrome'] });
                expect(captureGuard.isAppWhitelisted('VSCode')).toBe(true);
                expect(captureGuard.isAppWhitelisted('Chrome')).toBe(true);
            });

            it('should be case insensitive', () => {
                captureGuard.updateGuardSettings({ whitelistedApps: ['VSCode'] });
                expect(captureGuard.isAppWhitelisted('vscode')).toBe(true);
                expect(captureGuard.isAppWhitelisted('VSCODE')).toBe(true);
            });

            it('should handle .exe suffix', () => {
                captureGuard.updateGuardSettings({ whitelistedApps: ['VSCode'] });
                expect(captureGuard.isAppWhitelisted('VSCode.exe')).toBe(true);
            });

            it('should return false for non-whitelisted apps', () => {
                captureGuard.updateGuardSettings({ whitelistedApps: ['VSCode'] });
                expect(captureGuard.isAppWhitelisted('Notepad')).toBe(false);
            });
        });

        describe('shouldSkipCapture with whitelist', () => {
            it('should not skip when whitelist mode is disabled', () => {
                captureGuard.updateGuardSettings({
                    enableWhitelistMode: false,
                    whitelistedApps: ['VSCode']
                });

                expect(captureGuard.shouldSkipCapture('Notepad')).toBe(null);
            });

            it('should skip non-whitelisted apps when whitelist mode is enabled', () => {
                captureGuard.updateGuardSettings({
                    enableWhitelistMode: true,
                    whitelistedApps: ['VSCode']
                });

                expect(captureGuard.shouldSkipCapture('Notepad')).toBe('not_whitelisted');
            });

            it('should not skip whitelisted apps when whitelist mode is enabled', () => {
                captureGuard.updateGuardSettings({
                    enableWhitelistMode: true,
                    whitelistedApps: ['VSCode']
                });

                expect(captureGuard.shouldSkipCapture('VSCode')).toBe(null);
            });

            it('should still skip blacklisted apps even if whitelisted', () => {
                captureGuard.updateGuardSettings({
                    enableWhitelistMode: true,
                    whitelistedApps: ['1Password'],
                    blacklistedApps: ['1Password']
                });

                // Blacklist takes precedence
                expect(captureGuard.shouldSkipCapture('1Password')).toBe('blacklisted');
            });
        });
    });
});

