import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';

interface PageHeaderProps {
    icon?: LucideIcon;
    iconColor?: string;
    title: string;
    subtitle?: string;
    actions?: ReactNode;
}

/**
 * Standardized page header component for consistent styling across all pages.
 * - Title: text-2xl font-bold
 * - Icon: inline with title, size 22px
 * - Subtitle: text-sm text-zinc-500
 */
export function PageHeader({ icon: Icon, iconColor = 'text-indigo-400', title, subtitle, actions }: PageHeaderProps) {
    return (
        <div className="flex items-start justify-between mb-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                    {Icon && <Icon size={22} className={iconColor} />}
                    {title}
                </h1>
                {subtitle && (
                    <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>
                )}
            </div>
            {actions && (
                <div className="flex items-center gap-2">
                    {actions}
                </div>
            )}
        </div>
    );
}
