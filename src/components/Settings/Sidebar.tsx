import { ArrowLeft, Cpu, HardDrive, Plug, Settings, Sliders } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onBack: () => void;
}

export function Sidebar({ activeTab, onTabChange, onBack }: SidebarProps) {
    const tabs = [
        { id: 'general', label: 'General', icon: Sliders },
        { id: 'llm', label: 'AI Models', icon: Cpu },
        { id: 'mcp', label: 'MCP Tools', icon: Plug },
        { id: 'storage', label: 'Storage', icon: HardDrive },
    ];

    return (
        <div className="w-[240px] h-full bg-zinc-950/50 backdrop-blur-xl border-r border-zinc-800 flex flex-col flex-shrink-0 z-20">
            <div className="p-6">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors group mb-6 px-2"
                >
                    <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                    <span>Back to App</span>
                </button>

                <div className="h-px bg-zinc-800/50 mb-6" />

                <nav className="space-y-1">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all duration-200 group text-left",
                                activeTab === tab.id
                                    ? "bg-zinc-900 text-white font-medium shadow-sm ring-1 ring-zinc-800"
                                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
                            )}
                        >
                            <tab.icon size={16} className={cn(
                                "transition-colors",
                                activeTab === tab.id ? "text-indigo-400" : "text-zinc-500 group-hover:text-zinc-400"
                            )} />
                            <span>{tab.label}</span>
                            {activeTab === tab.id && (
                                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                            )}
                        </button>
                    ))}
                </nav>
            </div>

            <div className="mt-auto p-6 border-t border-zinc-900">
                <div className="flex items-center gap-3 px-2 opacity-50 hover:opacity-100 transition-opacity">
                    <div className="p-1.5 bg-zinc-900 rounded-md">
                        <Settings size={14} className="text-zinc-500" />
                    </div>
                    <span className="text-xs font-mono text-zinc-500">v0.1.0-alpha</span>
                </div>
            </div>
        </div>
    );
}
