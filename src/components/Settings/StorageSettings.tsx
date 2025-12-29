
import { AlertTriangle, Clock, Database, FolderOpen, HardDrive, MapPin, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Input } from './Shared';

const StatCard = ({ label, value, icon: Icon }: any) => (
    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center gap-4">
        <div className="p-3 bg-zinc-900 rounded-full">
            <Icon size={18} className="text-zinc-400" />
        </div>
        <div>
            <div className="text-xs text-zinc-500 uppercase font-medium">{label}</div>
            <div className="text-lg font-bold text-zinc-200">{value}</div>
        </div>
    </div>
);

export function StorageSettings() {
    const [clearing, setClearing] = useState(false);
    const [retentionDays, setRetentionDays] = useState('30');
    const [dataPath, setDataPath] = useState('Loading...');

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        if (window.ipcRenderer) {
            const settings = await window.ipcRenderer.invoke('get-settings');
            if (settings.storage_retention_days) {
                setRetentionDays(settings.storage_retention_days);
            }

            const path = await window.ipcRenderer.invoke('get-app-path', 'userData');
            setDataPath(path);
        }
    };

    const handleRetentionChange = async (val: string) => {
        setRetentionDays(val);
        if (window.ipcRenderer) {
            await window.ipcRenderer.invoke('set-setting', 'storage_retention_days', val);
        }
    };

    const handleOpenFolder = () => {
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('open-data-folder');
        }
    };

    const handleChangeLocation = async () => {
        if (window.ipcRenderer) {
            const newPath = await window.ipcRenderer.invoke('select-directory');
            if (newPath) {
                setDataPath(newPath); // Though app restarts usually
            }
        }
    };

    const handleClearStorage = async () => {
        // Require user to type "RESET" for confirmation
        const confirmation = prompt(
            'This will PERMANENTLY DELETE all timeline entries, screenshots, and chat history.\n\n' +
            'This action CANNOT be undone.\n\n' +
            'Type "RESET" to confirm:'
        );

        if (confirmation !== 'RESET') {
            if (confirmation !== null) {
                alert('Reset cancelled. You must type exactly "RESET" to confirm.');
            }
            return;
        }

        setClearing(true);
        try {
            if (window.ipcRenderer) {
                const result = await window.ipcRenderer.invoke('reset-database');
                if (result.success) {
                    const stats = result.stats;
                    const message = stats
                        ? `Database reset complete!\n\n• ${stats.filesDeleted} screenshot files deleted\n• ${stats.tablesCleared} database tables cleared`
                        : 'Database reset complete!';
                    alert(message);
                    // Reload the page to refresh all UI components
                    window.location.reload();
                } else {
                    alert('Failed to reset database: ' + (result.error || 'Unknown error'));
                }
            }
        } catch (err) {
            alert('Failed to reset database: ' + (err as Error).message);
        } finally {
            setClearing(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-zinc-100 mb-6">Storage Overview</h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <StatCard label="Database Size" value="24.5 MB" icon={Database} />
                    <StatCard label="Screenshots" value="1.2 GB" icon={HardDrive} />
                    <StatCard label="Total Items" value="15,420" icon={FolderOpen} />
                </div>

                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg mb-6">
                    <div className="flex items-center gap-4 flex-1 min-w-0 pr-4">
                        <div className="p-2 bg-indigo-500/10 rounded-lg">
                            <MapPin size={20} className="text-indigo-400" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-zinc-200 font-medium text-sm">Storage Location</div>
                            <div className="text-zinc-500 text-xs font-mono mt-0.5 truncate" title={dataPath}>
                                {dataPath}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={handleOpenFolder}>
                            Open Folder
                        </Button>
                        <Button variant="outline" onClick={handleChangeLocation}>
                            Change Location
                        </Button>
                    </div>
                </div>

                <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <div className="flex items-center gap-2 mb-4">
                        <Clock size={16} className="text-zinc-400" />
                        <span className="text-sm font-medium text-zinc-200">Retention Policy</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="max-w-[120px]">
                            <Input
                                type="number"
                                value={retentionDays}
                                onChange={(e) => handleRetentionChange(e.target.value)}
                                min="1"
                            />
                        </div>
                        <span className="text-sm text-zinc-500">days of history to keep</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                        Data older than this limit will be automatically deleted on startup.
                    </p>
                </div>
            </div>

            <div className="bg-red-950/10 border border-red-900/30 rounded-xl p-6">
                <div className="flex items-start gap-4">
                    <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
                        <AlertTriangle size={20} className="text-red-500" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-bold text-red-500 mb-2">Danger Zone</h3>
                        <p className="text-sm text-red-400/80 mb-6 max-w-lg">
                            Resetting the database will remove all timeline entries, journal logs, and analyzed data. This action cannot be undone.
                        </p>

                        <Button
                            onClick={handleClearStorage}
                            disabled={clearing}
                            variant="danger"
                            className="bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20 border-transparent"
                        >
                            <Trash2 size={16} />
                            {clearing ? 'Clearing Data...' : 'Reset Database'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
