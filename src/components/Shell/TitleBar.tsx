import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { invoke, on } from '../../lib/ipc';
import { cn } from '../../lib/utils';

export function TitleBar() {
    // Platform detection via window object (set by preload)
    const platform = (window as any).ipcRenderer?.platform || 'win32';
    const isMac = platform === 'darwin';
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        // Listen for maximize state changes using typed IPC
        const unsubscribe = on<boolean>('window-maximized', (_: unknown, val: boolean) => {
            setIsMaximized(val);
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    // Typed IPC handlers - no more @ts-ignore!
    const handleMin = () => invoke('window-min');
    const handleMax = () => invoke('window-max');
    const handleClose = () => invoke('window-close');

    return (
        <div className={cn(
            "fixed top-0 left-0 right-0 h-[40px] z-50 flex items-center select-none titlebar-drag",
            // Glassmorphism background only for TitleBar to avoid perf issues elsewhere
            // "bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800"
            // Actually, keep it solid/transparent to blend with Sidebar
            "bg-transparent"
        )}>
            {/* Mac Traffic Lights Placeholder (Left) */}
            {isMac && <div className="w-[80px] h-full" />}

            {/* Platform Neutral Content Area (e.g. Search) */}
            <div className="flex-1 flex items-center px-4">
                {/* Search Bar could go here */}
            </div>

            {/* Windows Controls (Right) */}
            {!isMac && (
                <div className="flex h-full titlebar-no-drag">
                    <button onClick={handleMin} className="h-full px-4 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                        <Minus size={16} />
                    </button>
                    <button onClick={handleMax} className="h-full px-4 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                        {isMaximized ? <Copy size={14} /> : <Square size={14} />}
                    </button>
                    <button onClick={handleClose} className="h-full px-4 hover:bg-red-600 text-zinc-400 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
