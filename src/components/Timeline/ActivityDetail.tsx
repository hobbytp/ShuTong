import { Clock, Info, Layout, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActivityCard, Observation, Screenshot } from '../../types';

interface ActivityDetailProps {
    cardId: number | null;
}

export function ActivityDetail({ cardId }: ActivityDetailProps) {
    const [card, setCard] = useState<ActivityCard | null>(null);
    const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
    const [playbackIndex, setPlaybackIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        if (!cardId) {
            setCard(null);
            return;
        }

        const fetchDetails = async () => {
            if (window.ipcRenderer) {
                const details = await window.ipcRenderer.invoke('get-card-details', cardId);
                setCard(details);

                const shots = await window.ipcRenderer.invoke('get-screenshots-for-card', cardId);
                setScreenshots(shots);
                setPlaybackIndex(0);
            }
        };

        fetchDetails();
    }, [cardId]);

    // Playback loop
    useEffect(() => {
        if (!isPlaying || screenshots.length === 0) return;

        const interval = setInterval(() => {
            setPlaybackIndex(prev => (prev + 1) % screenshots.length);
        }, 600); // Slightly slower for better readability

        return () => clearInterval(interval);
    }, [isPlaying, screenshots]);

    if (!cardId || !card) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 text-zinc-600 gap-4">
                <div className="p-4 rounded-full bg-zinc-900/50 border border-zinc-800">
                    <Layout size={32} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-medium tracking-wide">Select an activity to explore</p>
            </div>
        );
    }

    const currentShot = screenshots[playbackIndex];

    return (
        <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-y-auto no-scrollbar">
            {/* Header */}
            <div className="p-8 border-b border-zinc-900 bg-zinc-950/60 backdrop-blur-xl sticky top-0 z-20">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono bg-zinc-900 px-2 py-1 rounded-md border border-zinc-800">
                        <Clock size={12} />
                        {new Date(card.start_ts * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                    <span className="px-3 py-1 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-indigo-500/20">
                        {card.category}
                    </span>
                </div>
                <h1 className="text-3xl font-bold text-white mb-4 tracking-tight leading-tight">{card.title}</h1>
                <p className="text-zinc-400 text-lg leading-relaxed max-w-2xl font-medium">{card.summary}</p>
            </div>

            <div className="p-8 space-y-12">
                {/* Playback Area */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                            Visual Context
                        </h3>
                        {screenshots.length > 0 && !card.video_url && (
                            <span className="text-[10px] text-zinc-600 font-mono">{playbackIndex + 1} / {screenshots.length}</span>
                        )}
                    </div>

                    <div className="bg-black rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 aspect-video relative group ring-1 ring-zinc-800/50">
                        {card.video_url ? (
                            <video
                                key={card.video_url}
                                src={card.video_url}
                                controls
                                className="w-full h-full"
                                loop
                                autoPlay
                                data-testid="activity-video"
                            />
                        ) : currentShot ? (
                            <>
                                <img
                                    src={`media:///${currentShot.file_path.replace(/\\/g, '/')}`}
                                    className="w-full h-full object-contain"
                                    alt="Playback"
                                    data-testid="activity-image"
                                />

                                {/* Controls Overlay */}
                                <div className="absolute inset-0 bg-zinc-950/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px]">
                                    <button
                                        onClick={() => setIsPlaying(!isPlaying)}
                                        className="p-6 bg-white/10 rounded-full backdrop-blur-md hover:bg-white/20 transition-all transform hover:scale-110 active:scale-95 border border-white/20"
                                    >
                                        {isPlaying ? <Pause size={32} fill="white" /> : <Play size={32} fill="white" className="ml-1" />}
                                    </button>
                                </div>

                                {/* Progress Bar */}
                                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-900/80">
                                    <div
                                        className="h-full bg-white transition-all duration-300 shadow-[0_0_10px_white]"
                                        style={{ width: `${((playbackIndex + 1) / screenshots.length) * 100}%` }}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 gap-3 border-2 border-dashed border-zinc-900">
                                <Info size={32} strokeWidth={1} />
                                <span className="text-sm font-medium">No visual replay available</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sub-Observations */}
                <div className="pb-12">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-6">Activity Timeline</h3>
                    <div className="space-y-4">
                        {card.observations?.map((obs: Observation) => (
                            <div key={obs.id} className="flex gap-6 items-start group">
                                <div className="w-20 text-right text-[10px] text-zinc-600 font-mono pt-2 tracking-tighter shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                    {new Date(obs.start_ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </div>
                                <div className="relative flex-1 p-5 bg-zinc-900/50 rounded-2xl text-sm text-zinc-300 border border-zinc-800/50 group-hover:bg-zinc-900 group-hover:border-zinc-700 transition-all duration-300 leading-relaxed shadow-sm">
                                    <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-zinc-800 group-hover:bg-zinc-600 transition-colors" />
                                    {obs.observation}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
