import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "../../lib/utils"

interface TooltipProps {
    children: React.ReactNode
    content: string
    side?: 'right' | 'top' | 'bottom' | 'left'
}

export function Tooltip({ children, content, side = 'right' }: TooltipProps) {
    const [isVisible, setIsVisible] = React.useState(false);
    const [coords, setCoords] = React.useState({ top: 0, left: 0 });
    const triggerRef = React.useRef<HTMLDivElement>(null);

    const handleMouseEnter = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            let top = 0;
            let left = 0;
            // Defines gap
            const gap = 8;

            switch (side) {
                case 'right':
                    top = rect.top + (rect.height / 2); // Center Y
                    left = rect.right + gap;
                    break;
                case 'left':
                    top = rect.top + (rect.height / 2);
                    left = rect.left - gap;
                    break;
                case 'top':
                    top = rect.top - gap;
                    left = rect.left + (rect.width / 2);
                    break;
                case 'bottom':
                    top = rect.bottom + gap;
                    left = rect.left + (rect.width / 2);
                    break;
            }
            setCoords({ top, left });
            setIsVisible(true);
        }
    };

    return (
        <div
            ref={triggerRef}
            className="relative flex items-center group"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && createPortal(
                <div
                    style={{
                        top: coords.top,
                        left: coords.left,
                        // Center transform adjustment based on side
                        transform:
                            side === 'right' ? 'translateY(-50%)' :
                                side === 'left' ? 'translate(-100%, -50%)' :
                                    side === 'top' ? 'translate(-50%, -100%)' :
                                        'translate(-50%, 0)'
                    }}
                    className={cn(
                        "fixed z-[9999] px-2 py-1 text-xs font-medium text-white bg-zinc-900 border border-zinc-800 rounded shadow-sm whitespace-nowrap animate-in fade-in zoom-in-95 duration-200 pointer-events-none"
                    )}
                >
                    {content}
                </div>,
                document.body
            )}
        </div>
    )
}
