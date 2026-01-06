import { useEffect, useState } from 'react';
import { useSystemStore } from '../stores/systemStore';

export function StartupSplash() {
    const status = useSystemStore((state) => state.status);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        if (status !== 'BOOTING') {
            // Fade out animation
            const timer = setTimeout(() => setVisible(false), 500); // 500ms fade out
            return () => clearTimeout(timer);
        }
    }, [status]);

    if (!visible) return null;

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-500 ${status !== 'BOOTING' ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
            // Transparent Background for Floating Effect
            style={{
                background: 'transparent'
            }}
        >
            <div className="flex flex-col items-center relative">
                {/* Glow effect */}
                <div className="absolute w-[120px] h-[120px] rounded-full blur-[20px] -z-10 animate-breathe-glow"
                    style={{
                        background: 'radial-gradient(circle, rgba(56, 189, 248, 0.2) 0%, rgba(37, 99, 235, 0) 70%)'
                    }}
                />

                {/* Custom Logo with Drop Shadow */}
                <img
                    src="/ShuTong.png"
                    alt="ShuTong"
                    className="w-20 h-20 object-contain animate-breathe drop-shadow-[0_0_15px_rgba(56,189,248,0.3)]"
                />

                {/* Refined Text */}
                <p className="mt-10 text-zinc-600 text-xs font-mono tracking-[0.2em] font-medium uppercase opacity-80 animate-pulse">
                    INITIALIZING SYSTEM
                </p>
            </div>
        </div>
    );
}
