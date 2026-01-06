import { Activity, ArrowUpRight, Clock, Home, MonitorPlay, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/ui/card';

interface DashboardStats {
    focusTime: string;
    productivePercentage: number;
    lastActivity: string;
}

interface TimelineCard {
    id: number;
    title: string;
    start_ts: number;
    category: string;
}

export function Dashboard() {
    const { t } = useTranslation();
    const [stats, setStats] = useState<DashboardStats>({
        focusTime: '0h 0m',
        productivePercentage: 0,
        lastActivity: 'None'
    });
    const [recentCards, setRecentCards] = useState<TimelineCard[]>([]);

    // Optimistic Timer Logic (Client-side)
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const [isRecording, setIsRecording] = useState(false);

    const fetchData = async () => {
        if (window.ipcRenderer) {
            const s = await window.ipcRenderer.invoke('get-dashboard-stats');
            setStats(s);

            // Fetch generic timeline cards (dashboard agnostic)
            const cards = await window.ipcRenderer.invoke('get-timeline-cards', 5, 0);
            setRecentCards(cards);
        }
    };

    useEffect(() => {
        fetchData();

        // Initial check
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('get-recording-status').then(setIsRecording);

            // Listen for updates
            const removeListener = window.ipcRenderer.on('recording-state-changed', (_: any, recording: boolean) => {
                setIsRecording(recording);
                // Refresh data when recording state changes (might have new cards)
                fetchData();
            }) as unknown as () => void;

            return () => removeListener();
        }
    }, []);

    const handleToggleRecording = async () => {
        if (window.ipcRenderer) {
            if (isRecording) {
                await window.ipcRenderer.invoke('stop-recording-sync');
            } else {
                await window.ipcRenderer.invoke('start-recording-sync');
            }
        } else {
            // Mock toggle for browser
            setIsRecording(!isRecording);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto min-h-screen text-zinc-50">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                        <Home size={22} className="text-indigo-400" />
                        {t('dashboard.title', 'Dashboard')}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">{t('dashboard.subtitle', 'Overview of your day.')}</p>
                </div>
                <div className="text-right">
                    <p className="text-xl font-mono font-medium tracking-tight text-zinc-200">
                        {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">
                        {currentTime.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>
                </div>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

                {/* Hero Card: Focus Time */}
                <Card className="col-span-1 md:col-span-2 relative overflow-hidden bg-zinc-900 border-zinc-800 shadow-xl ring-1 ring-white/5 group">
                    <div className="absolute top-0 right-0 p-3 opacity-50 group-hover:opacity-100 transition-opacity">
                        <div className="p-1.5 bg-indigo-500/10 rounded-full">
                            <Clock size={16} className="text-indigo-400" />
                        </div>
                    </div>
                    <div className="p-6 flex flex-col justify-between h-full relative z-10">
                        <div>
                            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('dashboard.total_focus', 'Total Focus')}</span>
                            <h2 className="text-4xl font-bold text-white tracking-tighter mt-1">{stats.focusTime}</h2>
                        </div>
                        <div className="mt-4">
                            <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                                <span>{t('dashboard.productivity_score', 'Productivity Score')}</span>
                                <span className="text-indigo-400 font-bold">{stats.productivePercentage}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-1000 ease-out"
                                    style={{ width: `${Math.min(stats.productivePercentage, 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Background Gradient Mesh */}
                    <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-indigo-500/10 blur-[80px] rounded-full pointer-events-none" />
                </Card>

                {/* Quick Action: Recording */}
                <Card
                    className={`col-span-1 relative border transition-all duration-300 cursor-pointer overflow-hidden group
                        ${isRecording
                            ? 'bg-red-950/10 border-red-900/40 hover:bg-red-950/20'
                            : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:shadow-lg hover:shadow-indigo-500/5'
                        }`}
                    onClick={handleToggleRecording}
                >
                    <div className="p-5 flex flex-col items-center justify-center h-full gap-3 relative z-10">
                        <div className={`p-4 rounded-full transition-all duration-500 
                            ${isRecording
                                ? 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.4)] scale-110'
                                : 'bg-zinc-800 text-zinc-400 group-hover:bg-indigo-600 group-hover:text-white group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(79,70,229,0.4)]'
                            }`}
                        >
                            {isRecording ? (
                                <div className="w-5 h-5 rounded bg-current shadow-sm" />
                            ) : (
                                <MonitorPlay size={20} fill="currentColor" className="ml-0.5" />
                            )}
                        </div>
                        <div className="text-center">
                            <span className={`block font-bold text-base ${isRecording ? 'text-red-400' : 'text-zinc-200 group-hover:text-white'}`}>
                                {isRecording ? t('dashboard.stop_session', 'Stop Session') : t('dashboard.start_session', 'Start Session')}
                            </span>
                            <span className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors uppercase tracking-wide">
                                {isRecording ? t('dashboard.recording_active', 'Recording active...') : t('dashboard.resume_tracking', 'Resume tracking')}
                            </span>
                        </div>
                    </div>

                    {isRecording && (
                        <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none" />
                    )}
                </Card>

                {/* Insight Card */}
                <Card className="col-span-1 bg-zinc-900 border-zinc-800 ring-1 ring-white/5 relative overflow-hidden group">
                    <div className="p-5 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-2">
                            <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                                <Zap size={16} className="text-emerald-400" />
                            </div>
                            <ArrowUpRight size={14} className="text-zinc-600 group-hover:text-emerald-400 transition-colors" />
                        </div>
                        <div className="mt-auto">
                            <div className="text-2xl font-bold text-white mb-0.5">{stats.productivePercentage}%</div>
                            <p className="text-xs text-zinc-400">{t('dashboard.efficiency_rating', 'Efficiency Rating')}</p>
                            <p className="text-xs text-emerald-500/80 mt-1.5 font-medium uppercase tracking-wide">{t('dashboard.top_performance', 'Top performance zone')}</p>
                        </div>
                    </div>
                </Card>

            </div>

            {/* Recent Activity Feed */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 mb-1.5">
                    <Activity size={14} className="text-indigo-400" />
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t('dashboard.recent_activity', 'Recent Activity')}</h3>
                </div>

                <Card className="bg-zinc-900/50 border-zinc-800/50">
                    <div className="divide-y divide-zinc-800/50">
                        {recentCards.length > 0 ? recentCards.map((card) => (
                            <div key={card.id} className="flex items-center justify-between p-3 hover:bg-zinc-900/80 transition-colors group">
                                <div className="flex items-center gap-3">
                                    <div className={`w-1.5 h-1.5 rounded-full ring-2 ring-zinc-900 ${card.category === 'Work' ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' :
                                        card.category === 'Personal' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                                            'bg-zinc-500'
                                        }`} />
                                    <div>
                                        <p className="text-zinc-200 text-sm font-medium group-hover:text-indigo-300 transition-colors">{card.title}</p>
                                        <p className="text-xs text-zinc-500 font-mono mt-0.5 uppercase">{card.category}</p>
                                    </div>
                                </div>
                                <span className="text-zinc-500 text-xs font-mono bg-zinc-950/50 px-1.5 py-0.5 rounded border border-zinc-800">
                                    {new Date(card.start_ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        )) : (
                            <div className="p-6 text-center">
                                <p className="text-zinc-500 text-xs italic">{t('dashboard.no_activity', 'No recent activity detected yet.')}</p>
                            </div>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    );
}
