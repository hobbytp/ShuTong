import { BookOpen, Loader2, Moon, Save, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface JournalEntry {
    id: number
    content: string
    type: 'intention' | 'reflection'
    timestamp: string
}

export function Journal() {
    const { t } = useTranslation();
    const [entries, setEntries] = useState<JournalEntry[]>([])
    const [content, setContent] = useState('')
    const [type, setType] = useState<'intention' | 'reflection'>('intention')
    const [loading, setLoading] = useState(false)

    const fetchEntries = async () => {
        if (window.ipcRenderer) {
            const data = await window.ipcRenderer.invoke('get-journal-entries')
            setEntries(data)
        }
    }

    useEffect(() => {
        fetchEntries()
    }, [])

    const handleSubmit = async () => {
        if (!content.trim()) return

        setLoading(true)
        if (window.ipcRenderer) {
            await window.ipcRenderer.invoke('add-journal-entry', { content, type })
            setContent('')
            await fetchEntries()
        }
        setLoading(false)
    }

    return (
        <div className="p-8 max-w-3xl mx-auto text-zinc-50 min-h-screen">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                    <BookOpen className="w-6 h-6 text-indigo-400" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">Journal</h1>
            </div>

            {/* Input Section */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8 shadow-sm">
                <h2 className="text-lg font-semibold mb-4 text-zinc-200">{t('journal.new_entry', 'New Entry')}</h2>

                <div className="flex gap-4 mb-4">
                    <button
                        onClick={() => setType('intention')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg border transition-all ${type === 'intention'
                            ? 'bg-blue-950/50 border-blue-500/50 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:border-zinc-700'
                            }`}
                    >
                        <Sun size={18} className={type === 'intention' ? 'text-blue-400' : ''} />
                        {t('journal.intention', 'Intention')}
                    </button>
                    <button
                        onClick={() => setType('reflection')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg border transition-all ${type === 'reflection'
                            ? 'bg-purple-950/50 border-purple-500/50 text-purple-200 shadow-[0_0_15px_rgba(147,51,234,0.15)]'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:border-zinc-700'
                            }`}
                    >
                        <Moon size={18} className={type === 'reflection' ? 'text-purple-400' : ''} />
                        {t('journal.reflection', 'Reflection')}
                    </button>
                </div>

                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={type === 'intention' ? t('journal.placeholder_intention', 'What are your main goals for today?') : t('journal.placeholder_reflection', 'How did today go? What did you achieve?')}
                    className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 resize-none mb-4 transition-all"
                />

                <div className="flex justify-end">
                    <button
                        onClick={handleSubmit}
                        disabled={loading || !content.trim()}
                        className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all ${loading || !content.trim()
                            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'
                            }`}
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {loading ? t('journal.saving', 'Saving...') : t('journal.save_entry', 'Save Entry')}
                    </button>
                </div>
            </div>

            {/* List Section */}
            <h2 className="text-xl font-bold mb-6 text-zinc-200">{t('journal.history', 'History')}</h2>
            <div className="flex flex-col gap-4">
                {entries.map((entry) => (
                    <div
                        key={entry.id}
                        className={`bg-zinc-900/50 border rounded-xl p-5 hover:bg-zinc-900 transition-colors ${entry.type === 'intention' ? 'border-l-4 border-l-blue-500 border-y-zinc-800 border-r-zinc-800' : 'border-l-4 border-l-purple-500 border-y-zinc-800 border-r-zinc-800'
                            }`}
                    >
                        <div className="flex justify-between items-center mb-3">
                            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${entry.type === 'intention'
                                ? 'bg-blue-900/20 text-blue-300 border-blue-500/20'
                                : 'bg-purple-900/20 text-purple-300 border-purple-500/20'
                                }`}>
                                {entry.type.toUpperCase()}
                            </span>
                            <span className="text-xs text-zinc-500 font-mono">
                                {new Date(entry.timestamp).toLocaleString(undefined, {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                })}
                            </span>
                        </div>
                        <p className="text-zinc-300 whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                    </div>
                ))}

                {entries.length === 0 && (
                    <div className="text-center py-12 bg-zinc-900/30 rounded-xl border border-dashed border-zinc-800">
                        <p className="text-zinc-500">{t('journal.no_entries', 'No journal entries yet. Start writing above!')}</p>
                    </div>
                )}
            </div>
        </div>
    )
}
