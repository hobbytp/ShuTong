import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Storage
const mockGetSnapshotsBefore = vi.fn()
const mockDeleteSnapshotsBefore = vi.fn()

vi.mock('../../electron/storage', () => ({
    getSnapshotsBefore: (ts: number) => mockGetSnapshotsBefore(ts),
    deleteSnapshotsBefore: (ts: number) => mockDeleteSnapshotsBefore(ts),
    getSetting: vi.fn(),
    setSetting: vi.fn()
}))

// Mock FS
vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(),
        promises: {
            unlink: vi.fn(),
        },
    },
}))

// Import System Under Test (SUT)
import { cleanupOldSnapshots } from '../../electron/features/timeline'

describe('Storage Cleanup Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('should find and delete old snapshots', async () => {
        // Setup Date
        const now = new Date('2025-12-17T12:00:00Z')
        vi.setSystemTime(now)

        // Mock FS exists to return true
        // @ts-ignore
        fs.existsSync.mockReturnValue(true)

        // Retention 30 days
        const retentionDays = 30
        const retentionMs = 30 * 24 * 60 * 60 * 1000
        const cutoffDate = now.getTime() - retentionMs

        // Mock DB results (files to delete)
        const mockFiles = [
            { id: 1, file_path: '/path/to/old1.jpg', timestamp: cutoffDate - 1000 },
            { id: 2, file_path: '/path/to/old2.jpg', timestamp: cutoffDate - 2000 }
        ]
        mockGetSnapshotsBefore.mockReturnValue(mockFiles)

        // Execute
        await cleanupOldSnapshots(retentionDays)

        // Verify DB Query
        expect(mockGetSnapshotsBefore).toHaveBeenCalledWith(cutoffDate)

        // Verify File Deletion
        expect(fs.promises.unlink).toHaveBeenCalledWith('/path/to/old1.jpg')
        expect(fs.promises.unlink).toHaveBeenCalledWith('/path/to/old2.jpg')
        expect(fs.promises.unlink).toHaveBeenCalledTimes(2)

        // Verify DB Deletion (Cleanup rows after files)
        expect(mockDeleteSnapshotsBefore).toHaveBeenCalledWith(cutoffDate)
    })

    it('should handle file deletion errors gracefully', async () => {
        // Setup Date
        const now = new Date('2025-12-17T12:00:00Z')
        vi.setSystemTime(now)

        // Mock DB results
        const mockFiles = [
            { id: 1, file_path: '/path/to/missing.jpg', timestamp: 0 }
        ]
        mockGetSnapshotsBefore.mockReturnValue(mockFiles)

        // Mock Unlink Error (e.g. file not found)
        // @ts-ignore
        fs.promises.unlink.mockRejectedValue(new Error('File not found'))

        // Execute (Should not throw)
        await expect(cleanupOldSnapshots(30)).resolves.not.toThrow()

        // Should still attempt to delete from DB even if file missing? 
        // Usually yes, if file is gone, we want DB record gone too.
        expect(mockDeleteSnapshotsBefore).toHaveBeenCalled()
    })
})
