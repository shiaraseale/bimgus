import { useState, useEffect } from 'react';
import type { BotConfig } from '../types';
import { Settings, Send, Save, Bell, Link2, Bot, Sparkles } from 'lucide-react';

interface BotSettingsProps {
  config: BotConfig | null;
  clanTag: string;
  onSave: (updated: Partial<BotConfig>) => Promise<boolean>;
}

export const BotSettings: React.FC<BotSettingsProps> = ({ config, onSave }) => {
  const [formData, setFormData] = useState<BotConfig>(
    config || {
      clanTag: '#ABC123',
      webhooks: {},
      notificationsEnabled: {
        memberJoinedLeft: true,
        roleChanges: true,
        thUpgrades: true,
        warAttacks: true,
        warEndSummary: true,
        warAttackReminders: true,
        raidDistricts: true,
        cwlGroup: true,
        cwlRoundSummary: true,
        clanGamesStart: true,
        clanGamesTiers: true,
        clanGamesMaxers: true,
      },
    }
  );

  useEffect(() => {
    if (config) {
      setFormData(config);
    }
  }, [config]);

  const [isSaving, setIsSaving] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handleRegisterCommands = async () => {
    setIsRegistering(true);
    setStatusMsg({ text: 'Registering Discord slash commands...', ok: true });
    try {
      const res = await fetch('/api/discord/register-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({ text: `✅ ${data.message}`, ok: true });
      } else {
        setStatusMsg({ text: `❌ Discord registration failed: ${data.error || 'Check DISCORD_BOT_TOKEN and CLIENT_ID'}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: '❌ Could not connect to API server.', ok: false });
    } finally {
      setIsRegistering(false);
      setTimeout(() => setStatusMsg(null), 5000);
    }
  };

  const handleWebhookChange = (key: keyof BotConfig['webhooks'], value: string) => {
    setFormData((prev) => ({
      ...prev,
      webhooks: {
        ...prev.webhooks,
        [key]: value,
      },
    }));
  };

  const handleToggle = (key: keyof BotConfig['notificationsEnabled']) => {
    setFormData((prev) => ({
      ...prev,
      notificationsEnabled: {
        ...prev.notificationsEnabled,
        [key]: !prev.notificationsEnabled[key],
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatusMsg(null);
    const ok = await onSave(formData);
    setIsSaving(false);
    if (ok) {
      setStatusMsg({ text: '✅ Bot configuration saved to Firestore!', ok: true });
    } else {
      setStatusMsg({ text: '❌ Failed to save settings.', ok: false });
    }
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const testWebhook = async (url?: string, channelName?: string) => {
    if (!url) {
      setStatusMsg({ text: `Please enter a webhook URL for ${channelName} first.`, ok: false });
      return;
    }
    setTestingChannel(channelName || 'channel');
    setStatusMsg(null);
    try {
      const res = await fetch('/api/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: url, channelName }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({ text: `✅ Test message sent to ${channelName}!`, ok: true });
      } else {
        setStatusMsg({ text: `❌ Discord error: ${data.error}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: '❌ Could not connect to API server.', ok: false });
    } finally {
      setTestingChannel(null);
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  const webhookFields: Array<{ key: keyof BotConfig['webhooks']; label: string; placeholder: string }> = [
    { key: 'clanActivity', label: '#clan-activity', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'warRoom', label: '#war-room', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'cwlHub', label: '#cwl-hub', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'raidWeekend', label: '#raid-weekend', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'clanGames', label: '#clan-games', placeholder: 'https://discord.com/api/webhooks/...' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
      {/* Header Stone Panel */}
      <div className="coc-panel coc-panel-gold" style={{ padding: '24px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 className="gold-title" style={{ fontSize: '1.8rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Settings size={26} style={{ color: 'var(--gold)' }} />
            Co-Leader Bot Command Center
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', marginTop: '4px' }}>
            Configure Discord channel webhooks and live tracker notification preferences.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="coc-btn coc-btn-green"
          style={{ padding: '12px 24px', fontSize: '0.95rem' }}
        >
          <Save size={18} />
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {statusMsg && (
        <div
          className="coc-panel"
          style={{
            padding: '14px 20px',
            border: `2px solid ${statusMsg.ok ? 'var(--gem-green)' : 'var(--war-red)'}`,
            fontFamily: 'var(--font-coc)',
            fontSize: '0.95rem',
            color: statusMsg.ok ? '#86efac' : '#fca5a5',
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Grid: Webhooks + Toggles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        {/* Discord Webhooks Card */}
        <div className="coc-panel" style={{ padding: '24px' }}>
          <h3 className="gold-title" style={{ fontSize: '1.35rem', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link2 size={20} style={{ color: 'var(--dark-elixir)' }} />
            Discord Webhook Channels
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {webhookFields.map((wf) => (
              <div key={wf.key}>
                <label className="font-coc" style={{ display: 'block', fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '6px' }}>
                  {wf.label}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="password"
                    value={formData.webhooks[wf.key] || ''}
                    onChange={(e) => handleWebhookChange(wf.key, e.target.value)}
                    placeholder={wf.placeholder}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      background: '#0e141e',
                      border: '2px solid #28374d',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '0.88rem',
                      outline: 'none',
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)',
                    }}
                  />
                  <button
                    onClick={() => testWebhook(formData.webhooks[wf.key], wf.label)}
                    disabled={testingChannel === wf.label}
                    className="coc-btn coc-btn-blue"
                    style={{ padding: '8px 14px', fontSize: '0.8rem' }}
                    title="Send a test message to this channel"
                  >
                    <Send size={14} />
                    {testingChannel === wf.label ? 'Testing...' : 'Test'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notification Switches Card */}
        <div className="coc-panel" style={{ padding: '24px' }}>
          <h3 className="gold-title" style={{ fontSize: '1.35rem', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Bell size={20} style={{ color: 'var(--gold)' }} />
            Notification Toggles
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { key: 'memberJoinedLeft' as const, label: 'Member Joins & Departures' },
              { key: 'roleChanges' as const, label: 'Elder / Co-Leader Promotions' },
              { key: 'thUpgrades' as const, label: 'Town Hall Level Upgrades' },
              { key: 'warAttacks' as const, label: 'Live Clan War Attack Cards' },
              { key: 'warEndSummary' as const, label: 'War Victory / Defeat Recap' },
              { key: 'warAttackReminders' as const, label: '<4h Missed Attacks Warning' },
              { key: 'cwlGroup' as const, label: 'CWL Season Start & Tier Group Draw' },
              { key: 'cwlRoundSummary' as const, label: 'CWL Daily Round Summaries & Audits' },
              { key: 'raidDistricts' as const, label: 'Clan Capital District Completions' },
              { key: 'clanGamesMaxers' as const, label: '4,000 Clan Games Points Maxers' },
            ].map((item) => {
              const enabled = formData.notificationsEnabled[item.key];
              return (
                <div
                  key={item.key}
                  onClick={() => handleToggle(item.key)}
                  className="coc-well"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    border: enabled ? '2px solid #3d4f66' : '2px solid #1a2330',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '0.92rem', fontWeight: 600, color: enabled ? '#ffffff' : '#64748b' }}>
                    {item.label}
                  </span>
                  {/* CoC Style Switch */}
                  <div
                    style={{
                      width: '46px',
                      height: '24px',
                      background: enabled ? 'linear-gradient(180deg, #5cb811 0%, #3e8806 100%)' : '#1e293b',
                      border: '2px solid #0f172a',
                      borderRadius: '12px',
                      position: 'relative',
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
                      transition: 'background 0.2s',
                    }}
                  >
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        background: '#ffffff',
                        borderRadius: '50%',
                        position: 'absolute',
                        top: '2px',
                        left: enabled ? '24px' : '3px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.6)',
                        transition: 'left 0.2s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Discord Bot Slash Commands & Multi-Account Player DM Hub */}
      <div className="coc-panel coc-panel-gold" style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
          <div>
            <h3 className="gold-title" style={{ fontSize: '1.4rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bot size={24} style={{ color: 'var(--gold)' }} />
              Discord Slash Commands & Personal Upgrade DMs
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', marginTop: '4px' }}>
              Bimgus sends direct messages when upgrades finish, apprentice builder is unassigned, and war rosters lock in. Includes "Open CoC" quick-launch buttons!
            </p>
          </div>
          <button
            onClick={handleRegisterCommands}
            disabled={isRegistering}
            className="coc-btn coc-btn-blue"
            style={{ padding: '10px 20px', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Sparkles size={16} />
            {isRegistering ? 'Registering...' : 'Deploy Slash Commands to Discord'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          <div className="coc-well" style={{ padding: '16px' }}>
            <h4 style={{ color: '#67e8f9', fontSize: '1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              👤 Multi-Account Management
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.88rem' }}>
              <div><code>/link tag:#TAG [primary:true|false]</code> — Link your main or alt accounts to Discord.</div>
              <div><code>/accounts</code> — View all linked accounts & switch active account for commands.</div>
            </div>
          </div>

          <div className="coc-well" style={{ padding: '16px' }}>
            <h4 style={{ color: '#facc15', fontSize: '1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🛠️ Progression & Builders
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.88rem' }}>
              <div><code>/sixth-builder [account]</code> — Check progress towards unlocking B.O.B (6th Builder).</div>
              <div><code>/heroes [account] [village]</code> — Track hero maxing progress for current Town/Builder Hall.</div>
              <div><code>/upgrades [account]</code> — View in-progress & outstanding upgrades by resource.</div>
            </div>
          </div>

          <div className="coc-well" style={{ padding: '16px' }}>
            <h4 style={{ color: '#4ade80', fontSize: '1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⏰ Timers & Apprentice
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.88rem' }}>
              <div><code>/apprentice [action:assign|status]</code> — Track Apprentice Builder and get DM when idle.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
