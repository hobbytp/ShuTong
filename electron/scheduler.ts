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

export async function checkAndGenerateBriefing() {
    try {
        const { getLatestPulseCard, savePulseCard } = await import('./storage');
        const { pulseAgent } = await import('./agent/pulse-agent');

        // Check if we already have a briefing for today
        const latestBriefing = getLatestPulseCard('briefing');
        let shouldGenerate = true;

        if (latestBriefing) {
            const today = new Date().setHours(0, 0, 0, 0);
            const briefingDate = new Date(latestBriefing.created_at * 1000).setHours(0, 0, 0, 0);
            if (briefingDate === today) {
                shouldGenerate = false;
            }
        }

        if (shouldGenerate) {
            console.log('[Scheduler] Generating daily briefing...');
            // @ts-ignore
            const card = await pulseAgent.generateCard('briefing');

            savePulseCard({
                id: `briefing-${Date.now()}`,
                type: 'briefing',
                title: card.title,
                content: card.content,
                suggested_actions: card.suggested_actions,
                created_at: Math.floor(Date.now() / 1000)
            });

            new Notification({
                title: 'Daily Briefing Ready 🌟',
                body: 'Your AI-powered daily summary has been generated.'
            }).show();

            console.log('[Scheduler] Daily briefing generated and saved.');
        } else {
            console.log('[Scheduler] Daily briefing already exists for today.');
        }

    } catch (error: any) {
        const status = error?.status;
        const lcCode = error?.lc_error_code;
        const message = String(error?.message || '');

        if (message === 'LLM_API_KEY_MISSING') {
            console.warn('[Scheduler] Skipping daily briefing: LLM API key is not configured.');
            return;
        }

        if (status === 401 || lcCode === 'MODEL_AUTHENTICATION' || /MODEL_AUTHENTICATION/i.test(message)) {
            console.warn('[Scheduler] Skipping daily briefing: LLM authentication failed (401).');
            return;
        }

        console.error('[Scheduler] Failed to check/generate briefing:', message || error);
    }
}
