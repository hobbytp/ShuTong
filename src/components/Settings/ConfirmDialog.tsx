
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input } from "./Shared";

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
    requireTyping?: string; // If set, user must type this string to confirm
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    isDestructive = false,
    requireTyping,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const [typedValue, setTypedValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setTypedValue("");
            // Focus input on open if typing is required
            if (requireTyping) {
                setTimeout(() => inputRef.current?.focus(), 100);
            }
        }
    }, [isOpen, requireTyping]);

    if (!isOpen) return null;

    const isConfirmDisabled = requireTyping ? typedValue !== requireTyping : false;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div
                className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                    <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                        {isDestructive && <AlertTriangle size={18} className="text-red-500" />}
                        {title}
                    </h3>
                    <button
                        onClick={onCancel}
                        className="p-1 hover:bg-zinc-800 rounded-md transition-colors text-zinc-500 hover:text-zinc-300"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap mb-4">
                        {message}
                    </p>

                    {requireTyping && (
                        <div className="mb-4 space-y-2">
                            <label className="text-xs text-zinc-500 block">
                                Type <span className="font-mono font-bold text-red-400 select-all">{requireTyping}</span> to confirm:
                            </label>
                            <Input
                                ref={inputRef}
                                value={typedValue}
                                onChange={(e) => setTypedValue(e.target.value)}
                                placeholder={requireTyping}
                                className={isDestructive ? "border-red-900/30 focus-visible:ring-red-500/20" : ""}
                            />
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3 mt-6">
                        <Button variant="ghost" onClick={onCancel}>
                            {cancelText}
                        </Button>
                        <Button
                            variant={isDestructive ? "danger" : "default"}
                            onClick={onConfirm}
                            disabled={isConfirmDisabled}
                        >
                            {confirmText}
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
