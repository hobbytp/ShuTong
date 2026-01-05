import { FastForward, Film, Pause, Play, Rewind, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TimelineChatButton, TopicFilter } from '../components/TimelineChatButton'

interface Snapshot {
    id: number
    file_path: string
    timestamp: string
}

export function Timelapse() {
    const { t } = useTranslation();
    const [snapshots, setSnapshots] = useState<Snapshot[]>([])
    const [loading, setLoading] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentIndex, setCurrentIndex] = useState(0)
    const [playbackSpeed, setPlaybackSpeed] = useState(5) // frames per second
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
    const [activeFilter, setActiveFilter] = useState<TopicFilter | null>(null)

    const timerRef = useRef<NodeJS.Timeout | null>(null)

    const fetchSnapshots = async (date: string) => {
        setLoading(true)
        if (window.ipcRenderer) {
            let data;
            if (activeFilter) {
                data = await window.ipcRenderer.invoke('get-snapshots-by-filter', date, activeFilter);
            } else {
                data = await window.ipcRenderer.invoke('get-snapshots-by-date', date);
            }
            setSnapshots(data)
            setCurrentIndex(0)
            setIsPlaying(false)
        }
        setLoading(false)
    }

    useEffect(() => {
        fetchSnapshots(selectedDate)

        // Subscribe to real-time screenshot events for auto-refresh
        const cleanup = (window as any).electron?.on('app-event', (event: any) => {
            if (event.type === 'screenshot:captured') {
                // Refresh if viewing today's snapshots
                const today = new Date().toISOString().split('T')[0];
                if (selectedDate === today) {
                    fetchSnapshots(selectedDate);
                }
            }
        });

        return () => {
            stopPlayback();
            if (cleanup) cleanup();
        }
    }, [selectedDate, activeFilter])

    useEffect(() => {
        if (isPlaying) {
            startPlayback()
        } else {
            stopPlayback()
        }
        return () => stopPlayback()
    }, [isPlaying, playbackSpeed, snapshots.length])

    const startPlayback = () => {
        stopPlayback()
        if (snapshots.length === 0) return

        timerRef.current = setInterval(() => {
            setCurrentIndex((prev) => {
                if (prev >= snapshots.length - 1) {
                    setIsPlaying(false)
                    return prev
                }
                return prev + 1
            })
        }, 1000 / playbackSpeed)
    }

    const stopPlayback = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
    }

    const togglePlay = () => {
        if (currentIndex >= snapshots.length - 1) {
            setCurrentIndex(0)
        }
        setIsPlaying(!isPlaying)
    }

    const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newIndex = parseInt(e.target.value)
        setCurrentIndex(newIndex)
    }

    const currentSnapshot = snapshots[currentIndex]

    return (
        <div className="p-8 max-w-5xl mx-auto text-zinc-50 min-h-screen relative">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                        <Film className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">{t('timelapse.title', 'Timelapse')}</h1>
                        <p className="text-zinc-400">{t('timelapse.subtitle', 'Watch your day in review')}</p>
                    </div>
                </div>

                {/* Active Filter Badge */}
                {activeFilter && (
                    <div className="flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/30 rounded-lg px-3 py-1.5">
                        <span className="text-sm text-indigo-300">Filtering: <strong>{activeFilter.name}</strong></span>
                        <button
                            onClick={() => setActiveFilter(null)}
                            className="text-indigo-400 hover:text-white transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search size={16} className="text-zinc-500 group-focus-within:text-zinc-300" />
                    </div>
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-zinc-900 border border-zinc-700 rounded-lg py-2 pl-10 pr-4 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all shadow-sm"
                    />
                </div>
            </div>

            {loading ? (
                <div className="h-[500px] flex flex-col gap-4 items-center justify-center bg-zinc-900/30 border border-zinc-800 rounded-xl ring-1 ring-white/5">
                    <div className="w-12 h-12 border-4 border-zinc-700 border-t-indigo-500 rounded-full animate-spin"></div>
                    <p className="text-zinc-400 font-medium">{t('timelapse.loading', 'Loading snapshots...')}</p>
                </div>
            ) : snapshots.length > 0 ? (
                <div className="flex flex-col gap-6">
                    {/* Viewer */}
                    <div className="relative bg-black rounded-xl overflow-hidden aspect-video border border-zinc-800 shadow-2xl shadow-black/50 ring-1 ring-white/5 group">
                        {currentSnapshot ? (
                            <>
                                <img
                                    src={`media:///${currentSnapshot.file_path.replace(/\\/g, '/')}`}
                                    alt={`Frame ${currentIndex}`}
                                    className="w-full h-full object-contain"
                                />
                                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-xs font-mono text-zinc-300">
                                    {new Date(currentSnapshot.timestamp).toLocaleTimeString()}
                                </div>
                                <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-xs font-mono text-zinc-300">
                                    {currentIndex + 1} / {snapshots.length}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                                <Film size={48} strokeWidth={1} className="mb-4 opacity-50" />
                                <p>{t('timelapse.no_frame', 'No frame selected')}</p>
                            </div>
                        )}

                        {/* Play Overlay (when paused) */}
                        {!isPlaying && (
                            <div
                                className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white/90"
                                onClick={togglePlay}
                            >
                                <Play size={64} fill="currentColor" className="drop-shadow-lg" />
                            </div>
                        )}
                    </div>

                    {/* Controls */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg">
                        {/* Scrubber */}
                        <div className="flex items-center gap-4 mb-6">
                            <span className="text-xs font-mono text-zinc-500 w-16 text-right">{t('timelapse.start', 'Start')}</span>
                            <div className="relative flex-1 group/track">
                                <div className="absolute inset-0 bg-zinc-800 rounded-full h-2 my-auto"></div>
                                <div
                                    className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full h-2 my-auto"
                                    style={{ width: `${(currentIndex / (snapshots.length - 1)) * 100}%` }}
                                ></div>
                                <input
                                    type="range"
                                    min="0"
                                    max={snapshots.length - 1}
                                    value={currentIndex}
                                    onChange={handleScrubberChange}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                            </div>
                            <span className="text-xs font-mono text-zinc-500 w-16">{t('timelapse.end', 'End')}</span>
                        </div>

                        {/* Buttons */}
                        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                            {/* Playback Controls */}
                            <div className="flex items-center gap-6">
                                <button
                                    onClick={() => setCurrentIndex(Math.max(0, currentIndex - 10))}
                                    className="text-zinc-400 hover:text-white transition-colors p-2 hover:bg-zinc-800 rounded-full"
                                >
                                    <Rewind size={20} />
                                </button>

                                <button
                                    onClick={togglePlay}
                                    className="w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-900/30 transition-all hover:scale-105 active:scale-95"
                                >
                                    {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                                </button>

                                <button
                                    onClick={() => setCurrentIndex(Math.min(snapshots.length - 1, currentIndex + 10))}
                                    className="text-zinc-400 hover:text-white transition-colors p-2 hover:bg-zinc-800 rounded-full"
                                >
                                    <FastForward size={20} />
                                </button>
                            </div>

                            {/* Speed Control */}
                            <div className="flex items-center bg-zinc-950 rounded-lg p-1 border border-zinc-800">
                                {[1, 5, 10, 20].map(speed => (
                                    <button
                                        key={speed}
                                        onClick={() => setPlaybackSpeed(speed)}
                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${playbackSpeed === speed
                                            ? 'bg-zinc-800 text-white shadow-sm'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                            }`}
                                    >
                                        {speed}x
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="h-[400px] flex flex-col items-center justify-center bg-zinc-900/30 border border-dashed border-zinc-800 rounded-xl p-8 text-center">
                    <div className="p-4 bg-zinc-900 rounded-full mb-4">
                        <Film size={32} className="text-zinc-600" />
                    </div>
                    <p className="text-lg font-medium text-zinc-300 mb-2">{t('timelapse.no_recordings', 'No recordings found for')} {selectedDate}</p>
                    <p className="text-zinc-500 max-w-sm">
                        {t('timelapse.ensure_recording', 'ShuTong hasn\'t captured any snapshots for this day yet. Ensure recording is enabled!')}
                    </p>
                </div>
            )}

            {/* Chat FAB */}
            <TimelineChatButton onFilterChange={setActiveFilter} />
        </div>
    )
}
