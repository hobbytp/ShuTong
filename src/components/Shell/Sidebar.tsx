import { BarChart2, Clock, FileText, Home, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip-simple';

interface SidebarProps {
    activePage: string;
    onNavigate: (page: string) => void;
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
    const navItems = [
        { id: 'home', icon: Home, label: 'Home' },
        { id: 'timeline', icon: Clock, label: 'Timeline' },
        { id: 'journal', icon: FileText, label: 'Journal' },
        { id: 'timelapse', icon: BarChart2, label: 'Timelapse' },
    ];

    return (
        <div className={cn(
            "w-[64px] h-full flex flex-col bg-zinc-950/50 border-r border-zinc-800/50 pt-2 flex-shrink-0 transition-all items-center z-50",
            "backdrop-blur-xl"
        )}>
            <div className="flex-1 overflow-y-auto no-scrollbar py-4 flex flex-col gap-4 items-center w-full">
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
                <Tooltip content="Settings" side="right">
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
                        <span className="sr-only">Settings</span>
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
}
