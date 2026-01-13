import { Activity, Brain, Clock, FileText, Gauge, Home, PlayCircle, Settings, Sparkles, Sprout } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip-simple';

interface SidebarProps {
    activePage: string;
    onNavigate: (page: string) => void;
    isHydrated?: boolean; // true after HYDRATING state
}

import logo from '../../assets/logo.png';

export function Sidebar({ activePage, onNavigate, isHydrated = true }: SidebarProps) {
    const { t } = useTranslation();
    const navItems = [
        { id: 'home', icon: Home, label: t('sidebar.home', 'Home') },
        { id: 'timeline', icon: Clock, label: t('sidebar.timeline', 'Timeline') },
        { id: 'pulse', icon: Sparkles, label: t('sidebar.pulse', 'Pulse') },
        { id: 'sprout', icon: Sprout, label: t('sidebar.sprout', 'Sprout') },
        { id: 'insights', icon: Brain, label: t('sidebar.insights', 'Insights') },
        { id: 'analytics', icon: Activity, label: t('sidebar.analytics', 'Analytics') },
        { id: 'journal', icon: FileText, label: t('sidebar.journal', 'Journal') },
        { id: 'timelapse', icon: PlayCircle, label: t('sidebar.timelapse', 'Timelapse') },
        { id: 'performance', icon: Gauge, label: t('sidebar.performance', 'Performance') },
    ];

    return (
        <div className={cn(
            "w-[64px] h-full flex flex-col bg-zinc-950/50 border-r border-zinc-800/50 pt-4 flex-shrink-0 items-center z-50",
            "backdrop-blur-xl",
            "transition-transform duration-700 ease-out",
            isHydrated ? "translate-x-0" : "-translate-x-full"
        )}>
            {/* Logo */}
            <div className="mb-4">
                <img src={logo} alt="ShuTong" className="w-10 h-10 object-contain drop-shadow-md transition-transform hover:scale-105" />
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar py-2 flex flex-col gap-4 items-center w-full">
                {navItems.map(item => (
                    <Tooltip key={item.id} content={item.label} side="right">
                        <Button
                            variant={activePage === item.id ? "secondary" : "ghost"}
                            className={cn(
                                "w-10 h-10 p-0 rounded-xl", // Square-ish with soft corners
                                activePage === item.id && "bg-zinc-800 text-indigo-400 shadow-sm ring-1 ring-white/5"
                            )}
                            onClick={() => onNavigate(item.id)}
                        >
                            <item.icon size={20} className={cn(
                                "text-zinc-400 transition-colors",
                                activePage === item.id && "text-indigo-400"
                            )} />
                            <span className="sr-only">{item.label}</span>
                        </Button>
                    </Tooltip>
                ))}
            </div>

            <div className="p-3 border-t border-zinc-800/50 w-full flex justify-center flex-shrink-0 mt-auto">
                <Tooltip content={t('sidebar.settings', 'Settings')} side="right">
                    <Button
                        variant={activePage === 'settings' ? "secondary" : "ghost"}
                        className={cn(
                            "w-10 h-10 p-0 rounded-xl",
                            activePage === 'settings' && "bg-zinc-800 text-indigo-400 shadow-sm"
                        )}
                        onClick={() => onNavigate('settings')}
                    >
                        <Settings size={20} className={cn(
                            "text-zinc-400",
                            activePage === 'settings' && "text-indigo-400"
                        )} />
                        <span className="sr-only">{t('sidebar.settings', 'Settings')}</span>
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
}
