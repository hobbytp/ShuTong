import { describe, expect, it } from 'vitest'

/**
 * Scheduler Logic Tests (TDD)
 * 
 * Logic:
 * - checkReminders(currentDate, settings) -> returns 'morning' | 'evening' | null
 * - Should match HH:MM exactly (or within same minute)
 * - Should not return anything if disabled
 */

export interface ReminderSettings {
    reminder_morning_enabled: boolean
    reminder_morning_time: string // "HH:MM"
    reminder_evening_enabled: boolean
    reminder_evening_time: string // "HH:MM"
}

export function checkReminders(now: Date, settings: ReminderSettings): 'morning' | 'evening' | null {
    const currentHours = now.getHours()
    const currentMinutes = now.getMinutes()

    const currentTimeStr = `${currentHours.toString().padStart(2, '0')}:${currentMinutes.toString().padStart(2, '0')}`

    if (settings.reminder_morning_enabled && settings.reminder_morning_time === currentTimeStr) {
        return 'morning'
    }

    if (settings.reminder_evening_enabled && settings.reminder_evening_time === currentTimeStr) {
        return 'evening'
    }

    return null
}

describe('Scheduler Logic', () => {
    const baseSettings: ReminderSettings = {
        reminder_morning_enabled: true,
        reminder_morning_time: '09:00',
        reminder_evening_enabled: true,
        reminder_evening_time: '21:00'
    }

    it('should return nothing if time does not match', () => {
        const time = new Date('2025-12-17T08:00:00') // 08:00
        const result = checkReminders(time, baseSettings)
        expect(result).toBeNull()
    })

    it('should return morning when time matches morning setting', () => {
        const time = new Date('2025-12-17T09:00:15') // 09:00:15 matches 09:00 minute
        const result = checkReminders(time, baseSettings)
        expect(result).toBe('morning')
    })

    it('should return evening when time matches evening setting', () => {
        const time = new Date('2025-12-17T21:00:59')
        const result = checkReminders(time, baseSettings)
        expect(result).toBe('evening')
    })

    it('should return nothing if disabled', () => {
        const disabledSettings = { ...baseSettings, reminder_morning_enabled: false }
        const time = new Date('2025-12-17T09:00:00')
        const result = checkReminders(time, disabledSettings)
        expect(result).toBeNull()
    })
})
