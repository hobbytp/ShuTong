import { Activity, ArrowUpRight, Clock, MonitorPlay, Zap } from 'lucide-react';
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
        <div className="p-8 max-w-5xl mx-auto min-h-screen text-zinc-50">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-10">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">{t('dashboard.title', 'Dashboard')}</h1>
                    <p className="text-zinc-400">{t('dashboard.subtitle', 'Overview of your day.')}</p>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-mono font-medium tracking-tight text-zinc-200">
                        {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-sm text-zinc-500 font-medium uppercase tracking-widest">
                        {currentTime.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>
                </div>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">

                {/* Hero Card: Focus Time */}
                <Card className="col-span-1 md:col-span-2 relative overflow-hidden bg-zinc-900 border-zinc-800 shadow-xl ring-1 ring-white/5 group">
                    <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                        <div className="p-2 bg-indigo-500/10 rounded-full">
                            <Clock size={20} className="text-indigo-400" />
                        </div>
                    </div>
                    <div className="p-8 flex flex-col justify-between h-full relative z-10">
                        <div>
                            <span className="text-sm font-medium text-zinc-500 uppercase tracking-wider">{t('dashboard.total_focus', 'Total Focus')}</span>
                            <h2 className="text-5xl font-bold text-white tracking-tighter mt-2">{stats.focusTime}</h2>
                        </div>
                        <div className="mt-8">
                            <div className="flex justify-between text-xs text-zinc-400 mb-2">
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
                    <div className="p-6 flex flex-col items-center justify-center h-full gap-4 relative z-10">
                        <div className={`p-5 rounded-full transition-all duration-500 
                            ${isRecording
                                ? 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.4)] scale-110'
                                : 'bg-zinc-800 text-zinc-400 group-hover:bg-indigo-600 group-hover:text-white group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(79,70,229,0.4)]'
                            }`}
                        >
                            {isRecording ? (
                                <div className="w-6 h-6 rounded bg-current shadow-sm" />
                            ) : (
                                <MonitorPlay size={24} fill="currentColor" className="ml-0.5" />
                            )}
                        </div>
                        <div className="text-center">
                            <span className={`block font-bold text-lg ${isRecording ? 'text-red-400' : 'text-zinc-200 group-hover:text-white'}`}>
                                {isRecording ? t('dashboard.stop_session', 'Stop Session') : t('dashboard.start_session', 'Start Session')}
                            </span>
                            <span className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">
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
                    <div className="p-6 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 bg-emerald-500/10 rounded-lg">
                                <Zap size={18} className="text-emerald-400" />
                            </div>
                            <ArrowUpRight size={16} className="text-zinc-600 group-hover:text-emerald-400 transition-colors" />
                        </div>
                        <div className="mt-auto">
                            <div className="text-3xl font-bold text-white mb-1">{stats.productivePercentage}%</div>
                            <p className="text-sm text-zinc-400">{t('dashboard.efficiency_rating', 'Efficiency Rating')}</p>
                            <p className="text-xs text-emerald-500/80 mt-2 font-medium">{t('dashboard.top_performance', 'Top performance zone')}</p>
                        </div>
                    </div>
                </Card>

            </div>

            {/* Recent Activity Feed */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <Activity size={16} className="text-indigo-400" />
                    <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider">{t('dashboard.recent_activity', 'Recent Activity')}</h3>
                </div>

                <Card className="bg-zinc-900/50 border-zinc-800/50">
                    <div className="divide-y divide-zinc-800/50">
                        {recentCards.length > 0 ? recentCards.map((card) => (
                            <div key={card.id} className="flex items-center justify-between p-4 hover:bg-zinc-900/80 transition-colors group">
                                <div className="flex items-center gap-4">
                                    <div className={`w-2 h-2 rounded-full ring-2 ring-zinc-900 ${card.category === 'Work' ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' :
                                        card.category === 'Personal' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                                            'bg-zinc-500'
                                        }`} />
                                    <div>
                                        <p className="text-zinc-200 font-medium group-hover:text-indigo-300 transition-colors">{card.title}</p>
                                        <p className="text-xs text-zinc-500 font-mono mt-0.5">{card.category}</p>
                                    </div>
                                </div>
                                <span className="text-zinc-500 text-xs font-mono bg-zinc-950/50 px-2 py-1 rounded border border-zinc-800">
                                    {new Date(card.start_ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        )) : (
                            <div className="p-8 text-center">
                                <p className="text-zinc-500 text-sm italic">{t('dashboard.no_activity', 'No recent activity detected yet.')}</p>
                            </div>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    );
}
