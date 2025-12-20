import { Notification } from 'electron'

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

export function sendNotification(type: 'morning' | 'evening') {
    const title = type === 'morning' ? 'Good Morning! ☀️' : 'Good Evening! 🌙'
    const body = type === 'morning'
        ? 'Time to set your intentions for the day.'
        : 'Time to reflect on your day.'

    new Notification({ title, body }).show()
}
