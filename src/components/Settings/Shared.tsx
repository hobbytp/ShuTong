import { cn } from '../../lib/utils';

export const Label = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <label className={cn("block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide", className)}>
        {children}
    </label>
);

import React from 'react';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
    <input
        {...props}
        ref={ref}
        className={cn(
            "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50 transition-all",
            props.className
        )}
    />
));
Input.displayName = 'Input';

export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <div className="relative">
        <select
            {...props}
            className={cn(
                "w-full appearance-none bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50 transition-all cursor-pointer",
                props.className
            )}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </div>
    </div>
);

export const Section = ({ title, children, className }: { title: string, children: React.ReactNode, className?: string }) => (
    <div className={cn("bg-zinc-900/50 border border-zinc-800 rounded-xl p-6", className)}>
        <h3 className="text-lg font-bold text-zinc-100 mb-6">{title}</h3>
        <div className="space-y-6">
            {children}
        </div>
    </div>
);

export const Button = ({ children, variant = 'primary', className, ...props }: any) => {
    const baseClass = "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2 justify-center disabled:opacity-50 disabled:cursor-not-allowed";
    const variants = {
        primary: "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20",
        danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20",
        ghost: "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800",
        outline: "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
    };
    return (
        <button
            className={cn(baseClass, variants[variant as keyof typeof variants], className)}
            {...props}
        >
            {children}
        </button>
    );
};
