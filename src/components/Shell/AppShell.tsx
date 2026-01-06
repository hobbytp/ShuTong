import { ReactNode } from 'react';
import { useSystemStore } from '../../stores/systemStore';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

interface AppShellProps {
    children: ReactNode;
    activePage: string;
    onNavigate: (page: string) => void;
}

export function AppShell({ children, activePage, onNavigate }: AppShellProps) {
    const status = useSystemStore((state) => state.status);
    const isHydrated = status !== 'BOOTING';

    return (
        <div className={`h-screen w-screen flex flex-col overflow-hidden text-zinc-50 transition-colors duration-1000 ${status === 'BOOTING' ? 'bg-transparent' : 'bg-zinc-950'
            }`}>
            <TitleBar />

            <div className="flex-1 flex pt-[40px] relative min-h-0">
                {/* Sidebar with slide-in animation */}
                <Sidebar activePage={activePage} onNavigate={onNavigate} isHydrated={isHydrated} />

                {/* Main Content Area */}
                <main className="flex-1 overflow-auto bg-zinc-950 relative">
                    {/* Content Container */}
                    <div className="min-h-full">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
