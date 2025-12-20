import { describe, expect, it } from 'vitest'
import { formatDuration } from '../../src/utils/time'

describe('TimeUtils', () => {
    it('formats seconds into MM:SS', () => {
        expect(formatDuration(0)).toBe('00:00')
        expect(formatDuration(61)).toBe('01:01')
        expect(formatDuration(3600)).toBe('01:00:00')
    })
})
