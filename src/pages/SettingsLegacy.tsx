import { useEffect, useState } from 'react';
import { aiService } from '../services/ai/openai';

export function Settings() {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [mcpCommand, setMcpCommand] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');
  const [mcpEnv, setMcpEnv] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
  const [mcpStatus, setMcpStatus] = useState<'idle' | 'connected' | 'error'>('idle');

  // Notification Settings
  const [morningEnabled, setMorningEnabled] = useState(false);
  const [morningTime, setMorningTime] = useState('09:00');
  const [eveningEnabled, setEveningEnabled] = useState(false);
  const [eveningTime, setEveningTime] = useState('21:00');

  // Storage Settings
  const [retentionDays, setRetentionDays] = useState(30);
  const [recordingPath, setRecordingPath] = useState('');
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    // Load settings from backend
    // @ts-ignore
    window.ipcRenderer.invoke('get-settings').then((settings: any) => {
      if (settings.openai_base_url) setBaseUrl(settings.openai_base_url);
      if (settings.openai_api_key) setApiKey(settings.openai_api_key);
      if (settings.openai_model_name) setModelName(settings.openai_model_name);
      if (settings.mcp_command) setMcpCommand(settings.mcp_command);
      if (settings.mcp_args) setMcpArgs(settings.mcp_args);
      if (settings.mcp_env) setMcpEnv(settings.mcp_env);

      if (settings.reminder_morning_enabled) setMorningEnabled(settings.reminder_morning_enabled === 'true');
      if (settings.reminder_morning_time) setMorningTime(settings.reminder_morning_time);
      if (settings.reminder_evening_enabled) setEveningEnabled(settings.reminder_evening_enabled === 'true');
      if (settings.reminder_evening_time) setEveningTime(settings.reminder_evening_time);

      if (settings.storage_retention_days) setRetentionDays(parseInt(settings.storage_retention_days, 10));
      if (settings.recording_path) setRecordingPath(settings.recording_path);
    });
  }, []);

  const handleSelectDirectory = async () => {
    // @ts-ignore
    const path = await window.ipcRenderer.invoke('select-directory');
    if (path) {
      setRecordingPath(path);
      // @ts-ignore
      await window.ipcRenderer.invoke('set-setting', 'recording_path', path);
    }
  };

  const handleSave = async () => {
    setStatus('checking');

    // Save to backend
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'openai_base_url', baseUrl);
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'openai_api_key', apiKey);
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'openai_model_name', modelName);

    // Configure Service
    aiService.configure(apiKey, baseUrl);

    // Test Connection
    const success = await aiService.checkConnection();
    setStatus(success ? 'success' : 'error');
  };

  const handleSaveMcp = async () => {
    try {
      // @ts-ignore
      await window.ipcRenderer.invoke('set-setting', 'mcp_command', mcpCommand);
      // @ts-ignore
      await window.ipcRenderer.invoke('set-setting', 'mcp_args', mcpArgs);
      // @ts-ignore
      await window.ipcRenderer.invoke('set-setting', 'mcp_env', mcpEnv);
      setMcpStatus('connected');
    } catch (err) {
      setMcpStatus('error');
    }
  };

  const handleSaveReminders = async () => {
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'reminder_morning_enabled', String(morningEnabled));
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'reminder_morning_time', morningTime);
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'reminder_evening_enabled', String(eveningEnabled));
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'reminder_evening_time', eveningTime);
    alert('Reminder settings saved!');
  };

  const handleSaveRetention = async () => {
    // @ts-ignore
    await window.ipcRenderer.invoke('set-setting', 'storage_retention_days', String(retentionDays));
    alert('Storage settings saved!');
  };

  const handleManualCleanup = async () => {
    if (!confirm(`Are you sure you want to delete snapshots older than ${retentionDays} days? This cannot be undone.`)) return;

    setCleaning(true);
    try {
      // @ts-ignore
      await window.ipcRenderer.invoke('trigger-cleanup', retentionDays);
      alert('Cleanup completed!');
    } catch (err) {
      alert('Cleanup failed see console.');
      console.error(err);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div style={{ padding: '32px', maxWidth: '672px', margin: '0 auto', color: 'white' }}>
      <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '32px' }}>Settings</h1>

      {/* AI Provider Configuration */}
      <div style={{ backgroundColor: '#1F2937', padding: '24px', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px' }}>AI Provider (OpenAI Compatible)</h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#9CA3AF', marginBottom: '4px' }}>Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            style={{ width: '100%', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '6px', padding: '8px', color: 'white' }}
          />
          <p style={{ color: '#6B7280', fontSize: '12px', marginTop: '4px' }}>
            Works with OpenAI, Ollama (http://localhost:11434/v1), Gemini, DeepSeek, etc.
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#9CA3AF', marginBottom: '4px' }}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={{ width: '100%', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '6px', padding: '8px', color: 'white' }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#9CA3AF', marginBottom: '4px' }}>Model Name</label>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="gpt-4o, llama3.2, deepseek-chat, etc."
            style={{ width: '100%', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '6px', padding: '8px', color: 'white' }}
          />
          <p style={{ color: '#6B7280', fontSize: '12px', marginTop: '4px' }}>
            The model identifier used for API requests.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingTop: '16px' }}>
          <button
            onClick={handleSave}
            disabled={status === 'checking'}
            style={{ padding: '8px 16px', backgroundColor: '#2563EB', color: 'white', borderRadius: '6px', fontWeight: '600', border: 'none', cursor: 'pointer', opacity: status === 'checking' ? 0.5 : 1 }}
          >
            {status === 'checking' ? 'Checking...' : 'Save & Test Connection'}
          </button>

          {status === 'success' && <span style={{ color: '#10B981' }}>Connection Verified ✓</span>}
          {status === 'error' && <span style={{ color: '#EF4444' }}>Connection Failed ✗</span>}
        </div>
      </div>

      {/* MCP Configuration */}
      <div style={{ backgroundColor: '#1F2937', padding: '24px', borderRadius: '8px', marginTop: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px' }}>MCP Server (Tool Calling)</h2>
        <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
          Connect to an MCP server to enable external tools like file access, web search, etc.
        </p>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#9CA3AF', marginBottom: '4px' }}>Command</label>
          <input
            type="text"
            value={mcpCommand}
            onChange={(e) => setMcpCommand(e.target.value)}
            placeholder="npx, python, node, etc."
            style={{ width: '100%', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '6px', padding: '8px', color: 'white' }}
          />
          <p style={{ color: '#6B7280', fontSize: '12px', marginTop: '4px' }}>
            The command to spawn the MCP server process.
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#9CA3AF', marginBottom: '4px' }}>Arguments</label>
          <input
            type="text"
            value={mcpArgs}
            onChange={(e) => setMcpArgs(e.target.value)}
            placeholder="-y @anthropics/mcp-server-filesystem /path/to/dir"
            style={{ width: '100%', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '6px', padding: '8px', color: 'white' }}
          />
          <p style={{ color: '#6B7280', fontSize: '12px', marginTop: '4px' }}>
            Space-separated arguments for the command.
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#9CA3AF', marginBottom: '4px' }}>Environment Variables</label>
          <input
            type="text"
            value={mcpEnv}
            onChange={(e) => setMcpEnv(e.target.value)}
            placeholder="KEY1=value1,KEY2=value2"
            style={{ width: '100%', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '6px', padding: '8px', color: 'white' }}
          />
          <p style={{ color: '#6B7280', fontSize: '12px', marginTop: '4px' }}>
            Comma-separated KEY=value pairs for environment variables.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={handleSaveMcp}
            style={{ padding: '8px 16px', backgroundColor: '#059669', color: 'white', borderRadius: '6px', fontWeight: '600', border: 'none', cursor: 'pointer' }}
          >
            Save MCP Config
          </button>
          {mcpStatus === 'connected' && <span style={{ color: '#10B981' }}>Config Saved ✓</span>}
          {mcpStatus === 'error' && <span style={{ color: '#EF4444' }}>Error</span>}
        </div>
      </div>

      {/* Notification Reminders */}
      <div style={{ backgroundColor: '#1F2937', padding: '24px', borderRadius: '8px', marginTop: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px' }}>Daily Reminders</h2>
        <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
          Get notified to set intentions and reflect on your day.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Morning */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '14px', color: '#9CA3AF' }}>☀️ Morning Intention</label>
              <input
                type="checkbox"
                checked={morningEnabled}
                onChange={(e) => setMorningEnabled(e.target.checked)}
                style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
              />
            </div>
            <input
              type="time"
              value={morningTime}
              onChange={(e) => setMorningTime(e.target.value)}
              disabled={!morningEnabled}
              style={{
                width: '100%',
                backgroundColor: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                padding: '8px',
                color: 'white',
                opacity: morningEnabled ? 1 : 0.5
              }}
            />
          </div>

          {/* Evening */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '14px', color: '#9CA3AF' }}>🌙 Evening Reflection</label>
              <input
                type="checkbox"
                checked={eveningEnabled}
                onChange={(e) => setEveningEnabled(e.target.checked)}
                style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
              />
            </div>
            <input
              type="time"
              value={eveningTime}
              onChange={(e) => setEveningTime(e.target.value)}
              disabled={!eveningEnabled}
              style={{
                width: '100%',
                backgroundColor: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                padding: '8px',
                color: 'white',
                opacity: eveningEnabled ? 1 : 0.5
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <button
            onClick={handleSaveReminders}
            style={{ padding: '8px 16px', backgroundColor: '#7C3AED', color: 'white', borderRadius: '6px', fontWeight: '600', border: 'none', cursor: 'pointer' }}
          >
            Save Reminders
          </button>
        </div>
      </div>

      {/* Recording Storage */}
      <div style={{ backgroundColor: '#1F2937', padding: '24px', borderRadius: '8px', marginTop: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px' }}>Recording Storage</h2>
        <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
          Choose where to store your screenshots and timelapses.
        </p>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            readOnly
            value={recordingPath || 'Default (C: drive)'}
            style={{ flex: 1, backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '6px', padding: '8px', color: 'white', fontSize: '12px' }}
          />
          <button
            onClick={handleSelectDirectory}
            style={{ padding: '8px 16px', backgroundColor: '#374151', color: 'white', borderRadius: '6px', fontSize: '14px', fontWeight: '600', border: 'none', cursor: 'pointer' }}
          >
            Change...
          </button>
        </div>
      </div>

      {/* Storage Cleanup */}
      <div style={{ backgroundColor: '#1F2937', padding: '24px', borderRadius: '8px', marginTop: '24px', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px' }}>Storage Cleanup</h2>
        <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '16px' }}>
          Manage local disk space by automatically deleting old recordings.
        </p>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#9CA3AF', marginBottom: '8px' }}>
            Retention Period (Days): <span style={{ color: 'white', fontWeight: 'bold' }}>{retentionDays}</span>
          </label>
          <input
            type="range"
            min="1"
            max="365"
            value={retentionDays}
            onChange={(e) => setRetentionDays(parseInt(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
            <span>1 Day</span>
            <span>1 Year</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '24px' }}>
          <button
            onClick={handleSaveRetention}
            style={{ padding: '8px 16px', backgroundColor: '#374151', color: 'white', borderRadius: '6px', fontWeight: '600', border: 'none', cursor: 'pointer' }}
          >
            Save Setting
          </button>

          <button
            onClick={handleManualCleanup}
            disabled={cleaning}
            style={{ padding: '8px 16px', backgroundColor: '#DC2626', color: 'white', borderRadius: '6px', fontWeight: '600', border: 'none', cursor: 'pointer', opacity: cleaning ? 0.5 : 1 }}
          >
            {cleaning ? 'Cleaning...' : 'Clean Now'}
          </button>
        </div>
      </div>
    </div>
  );
}
