
import { Plug, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Shared';

export function MCPSettings() {
    const [servers, setServers] = useState([
        { id: 1, name: 'Filesystem', status: 'connected', type: 'stdio' },
        { id: 2, name: 'Browser', status: 'connected', type: 'stdio' }
    ]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-lg font-bold text-zinc-100">MCP Servers</h3>
                        <p className="text-sm text-zinc-400 mt-1">Manage Model Context Protocol connections.</p>
                    </div>
                    <Button>
                        <Plus size={14} /> Add Server
                    </Button>
                </div>

                <div className="space-y-3">
                    {servers.map((server) => (
                        <div key={server.id} className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg group hover:border-zinc-700 transition-colors">
                            <div className="flex items-center gap-4">
                                <div className="p-2.5 bg-zinc-900 rounded-lg">
                                    <Server size={18} className="text-indigo-400" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-medium text-zinc-200">{server.name}</h4>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        <span className="text-xs text-zinc-500 capitalize">{server.status}</span>
                                        <span className="text-zinc-700 text-[10px]">•</span>
                                        <span className="text-xs text-zinc-500 uppercase">{server.type}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost"><RefreshCw size={14} /></Button>
                                <Button variant="danger"><Trash2 size={14} /></Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex gap-3">
                <Plug className="text-blue-400 shrink-0 mt-0.5" size={18} />
                <div className="text-sm text-blue-200/80">
                    <p className="font-medium text-blue-200 mb-1">About MCP</p>
                    MCP (Model Context Protocol) allows ShuTong to securely access local resources and tools.
                    Configure servers here to expand your AI capabilities.
                </div>
            </div>
        </div>
    );
}
