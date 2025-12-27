import fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockActiveWindow = vi.fn()
const mockDesktopCapturerGetSources = vi.fn()

const mockAppGetPath = vi.fn((name: string) => {
    if (name === 'userData') return '/mock/userData'
    return '/mock'
})
const mockAppEmit = vi.fn()

vi.mock('electron', () => ({
    app: {
        getPath: mockAppGetPath,
        emit: mockAppEmit,
    },
    desktopCapturer: {
        getSources: mockDesktopCapturerGetSources,
    },
    ipcMain: {
        handle: vi.fn(),
    },
}))

const mockShouldSkipCapture = vi.fn(() => null)
const mockNotifyWindowChange = vi.fn()

vi.mock('../../electron/features/capture/capture-guard', () => ({
    clearPendingWindowCapture: vi.fn(),
    getIntervalMultiplier: vi.fn(() => 1.0),
    initCaptureGuard: vi.fn(),
    notifyWindowChange: (...args: any[]) => mockNotifyWindowChange(...args),
    onDebouncedCapture: vi.fn(),
    onWindowSwitch: vi.fn(),
    shouldSkipCapture: (...args: any[]) => mockShouldSkipCapture(...args),
    updateGuardSettings: vi.fn(),
}))

const mockIsFrameSimilar = vi.fn()
const mockResetLastFrame = vi.fn()

vi.mock('../../electron/features/capture/frame-dedup', () => ({
    isFrameSimilar: (...args: any[]) => mockIsFrameSimilar(...args),
    resetLastFrame: (...args: any[]) => mockResetLastFrame(...args),
    updateDedupSettings: vi.fn(),
}))

const mockGetSetting = vi.fn()
const mockSaveScreenshot = vi.fn()
const mockSaveWindowSwitch = vi.fn()

vi.mock('../../electron/storage', () => ({
    getSetting: (...args: any[]) => mockGetSetting(...args),
    saveScreenshot: (...args: any[]) => mockSaveScreenshot(...args),
    saveWindowSwitch: (...args: any[]) => mockSaveWindowSwitch(...args),
}))

const mockWriteFile = vi.fn()
const mockStatfs = vi.fn()
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()

vi.mock('fs', () => ({
    default: {
        existsSync: (...args: any[]) => mockExistsSync(...args),
        mkdirSync: (...args: any[]) => mockMkdirSync(...args),
        promises: {
            writeFile: (...args: any[]) => mockWriteFile(...args),
            statfs: (...args: any[]) => mockStatfs(...args),
        },
    },
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    promises: {
        writeFile: (...args: any[]) => mockWriteFile(...args),
        statfs: (...args: any[]) => mockStatfs(...args),
    },
}))

vi.mock('get-windows', () => ({
    activeWindow: (...args: any[]) => mockActiveWindow(...args),
}))

describe('Capture + Frame Dedup integration', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockExistsSync.mockReturnValue(true)
        mockWriteFile.mockResolvedValue(undefined)
        mockStatfs.mockRejectedValue(new Error('statfs not available'))
        mockShouldSkipCapture.mockReturnValue(null)
        mockNotifyWindowChange.mockClear()
        mockIsFrameSimilar.mockReset()
        mockResetLastFrame.mockClear()

        // @ts-ignore
        if (typeof fs.existsSync?.mockClear === 'function') fs.existsSync.mockClear()
    })

    function makeConfig(overrides: Partial<any> = {}) {
        return {
            interval: 1000,
            resolution: { width: 100, height: 100 },
            quality: 60,
            screenIndex: 0,
            minDiskSpaceGB: 1,
            captureMode: 'screen',
            excludedApps: [],
            excludedTitlePatterns: [],
            guard: {
                idleThreshold: 30,
                enableIdleDetection: true,
                enableLockDetection: true,
                debounceMs: 2000,
            },
            dedup: {
                similarityThreshold: 0.05,
                enableSimilarityDedup: true,
            },
            ...overrides,
        }
    }

    it('should skip storage when frame is similar and window did not change', async () => {
        vi.resetModules()

        mockActiveWindow.mockResolvedValue({
            title: 't',
            owner: { name: 'App', processId: 1 },
            id: 1,
        })

        const thumbnail = {
            isEmpty: () => false,
            getSize: () => ({ width: 100, height: 100 }),
            toBitmap: () => Buffer.alloc(100 * 100 * 4, 1),
            toJPEG: vi.fn(() => Buffer.from([1, 2, 3])),
        }

        mockDesktopCapturerGetSources.mockResolvedValue([{ thumbnail }])
        mockIsFrameSimilar.mockReturnValue(true)

        const capture = await import('../../electron/features/capture/capture.service')
        capture.__test__resetCaptureState()
        capture.__test__setLastCapturedWindowApp('App')

        await capture.__test__captureFrame(makeConfig())

        expect(mockResetLastFrame).not.toHaveBeenCalled()
        expect(mockIsFrameSimilar).toHaveBeenCalledTimes(1)
        expect(mockWriteFile).not.toHaveBeenCalled()
        expect(mockSaveScreenshot).not.toHaveBeenCalled()
        expect(thumbnail.toJPEG).not.toHaveBeenCalled()
    })

    it('should not run dedup on window change and should store screenshot', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-12-26T00:00:00Z'))
        vi.resetModules()

        mockActiveWindow.mockResolvedValue({
            title: 'new',
            owner: { name: 'NewApp', processId: 2 },
            id: 2,
        })

        const thumbnail = {
            isEmpty: () => false,
            getSize: () => ({ width: 100, height: 100 }),
            toBitmap: () => Buffer.alloc(100 * 100 * 4, 2),
            toJPEG: vi.fn(() => Buffer.from([1, 2, 3, 4])),
        }

        mockDesktopCapturerGetSources.mockResolvedValue([{ thumbnail }])
        mockIsFrameSimilar.mockReturnValue(true)

        const capture = await import('../../electron/features/capture/capture.service')
        capture.__test__resetCaptureState()
        capture.__test__setLastCapturedWindowApp('OldApp')

        await capture.__test__captureFrame(makeConfig())

        expect(mockNotifyWindowChange).toHaveBeenCalledTimes(1)
        expect(mockResetLastFrame).toHaveBeenCalledTimes(1)
        expect(mockIsFrameSimilar).not.toHaveBeenCalled()

        expect(thumbnail.toJPEG).toHaveBeenCalledTimes(1)
        expect(mockWriteFile).toHaveBeenCalledTimes(1)
        expect(mockSaveScreenshot).toHaveBeenCalledTimes(1)

        const saveCall = mockSaveScreenshot.mock.calls[0]
        expect(saveCall[3]).toBe('screen')
        expect(saveCall[4]).toBe('NewApp')

        vi.useRealTimers()
    })

    it('should notify window change when skipped by guard, but not capture or store', async () => {
        vi.resetModules()

        mockActiveWindow.mockResolvedValue({
            title: 't',
            owner: { name: 'App', processId: 1 },
            id: 1,
        })

        mockShouldSkipCapture.mockReturnValue('idle')

        const capture = await import('../../electron/features/capture/capture.service')
        capture.__test__resetCaptureState()
        capture.__test__setLastCapturedWindowApp('OldApp')

        await capture.__test__captureFrame(makeConfig())

        expect(mockNotifyWindowChange).toHaveBeenCalledTimes(1)
        expect(mockNotifyWindowChange).toHaveBeenCalledWith('App', 't')

        expect(mockDesktopCapturerGetSources).not.toHaveBeenCalled()
        expect(mockResetLastFrame).not.toHaveBeenCalled()
        expect(mockIsFrameSimilar).not.toHaveBeenCalled()
        expect(mockWriteFile).not.toHaveBeenCalled()
        expect(mockSaveScreenshot).not.toHaveBeenCalled()
    })
})
