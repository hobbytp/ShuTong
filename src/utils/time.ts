export function formatDuration(seconds: number): string {
    if (seconds < 0) return '00:00'

    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)

    const pad = (n: number) => n.toString().padStart(2, '0')

    if (h > 0) {
        return `${pad(h)}:${pad(m)}:${pad(s)}`
    }
    return `${pad(m)}:${pad(s)}`
}
