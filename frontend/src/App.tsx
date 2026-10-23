import { useState, useEffect } from 'react';
import type { ClanData, WarData, BotConfig } from './types';
import { Header } from './components/Header';
import { WarRoom } from './components/WarRoom';
import { RosterAudit } from './components/RosterAudit';
import { CapitalRaids } from './components/CapitalRaids';
import { ClanGamesView } from './components/ClanGamesView';
import { BotSettings } from './components/BotSettings';
import { AlertCircle } from 'lucide-react';

const CLAN_TAG = '#ABC123';

const getInitialTab = () => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && ['war', 'roster', 'capital', 'games', 'settings'].includes(tab)) {
      return tab;
    }
    const hash = window.location.hash.replace('#', '');
    if (hash && ['war', 'roster', 'capital', 'games', 'settings'].includes(hash)) {
      return hash;
    }
  }
  return 'war';
};

export function App() {
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [clan, setClan] = useState<ClanData | null>(null);
  const [war, setWar] = useState<WarData | null>(null);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adminKey, setAdminKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem('bimgus_admin_key') || '') : '';
  });

  const handleAdminKeyChange = (key: string) => {
    setAdminKey(key);
    if (key) {
      localStorage.setItem('bimgus_admin_key', key);
    } else {
      localStorage.removeItem('bimgus_admin_key');
      setConfig(null);
    }
  };

  const fetchConfig = async (keyToUse = adminKey) => {
    if (!keyToUse) return;
    try {
      const encodedTag = encodeURIComponent(CLAN_TAG);
      const configRes = await fetch(`/api/clan/${encodedTag}/config`, {
        headers: { 'X-Admin-Key': keyToUse },
      });
      if (configRes.ok) {
        const configJson = await configRes.json();
        if (configJson.success && configJson.data) {
          setConfig(configJson.data);
        }
      }
    } catch (e: any) {
      console.warn('Config fetch error:', e.message);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      window.history.replaceState({}, '', url.toString());
    }
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setError(null);
      const encodedTag = encodeURIComponent(CLAN_TAG);

      // Fetch clan data
      try {
        const clanRes = await fetch(`/api/clan/${encodedTag}`);
        if (clanRes.ok) {
          const clanJson = await clanRes.json();
          if (clanJson.success && clanJson.data) {
            setClan(clanJson.data);
          }
        }
      } catch (e: any) {
        console.warn('Clan data fetch error:', e.message);
      }

      // Fetch war data
      try {
        const warRes = await fetch(`/api/clan/${encodedTag}/war`);
        if (warRes.ok) {
          const warJson = await warRes.json();
          if (warJson.success && warJson.data) {
            setWar(warJson.data);
          }
        }
      } catch (e: any) {
        console.warn('War data fetch error:', e.message);
      }

      // Fetch bot config only if authenticated (never on public page load)
      if (adminKey) {
        await fetchConfig(adminKey);
      }
    } catch (err: any) {
      console.warn('API error:', err.message);
      setError('Could not connect to live API. Viewing cached snapshot.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSync = async () => {
    if (!adminKey) return;
    setIsSyncing(true);
    try {
      const encodedTag = encodeURIComponent(CLAN_TAG);
      await fetch(`/api/clan/${encodedTag}/poll`, {
        method: 'POST',
        headers: { 'X-Admin-Key': adminKey },
      });
      await fetchData();
    } catch {
      // ignore
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveConfig = async (updated: Partial<BotConfig>): Promise<boolean> => {
    if (!adminKey) return false;
    try {
      const encodedTag = encodeURIComponent(CLAN_TAG);
      const res = await fetch(`/api/clan/${encodedTag}/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': adminKey,
        },
        body: JSON.stringify(updated),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setConfig(data.data);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        clan={clan}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSync={handleSync}
        isSyncing={isSyncing}
        canSync={Boolean(adminKey)}
      />

      <main style={{ maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '0 20px 60px', flex: 1 }}>
        {error && (
          <div
            className="coc-panel"
            style={{
              marginTop: '20px',
              padding: '14px 20px',
              border: '2px solid var(--war-red)',
              color: '#fca5a5',
              fontSize: '0.92rem',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontFamily: 'var(--font-coc)',
            }}
          >
            <AlertCircle size={20} style={{ color: 'var(--war-red)' }} />
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '80px 20px', textAlign: 'center' }}>
            <div className="gold-title" style={{ fontSize: '1.8rem' }}>Loading Clan Bingo Data...</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '8px', fontWeight: 600 }}>
              Fetching real-time village & war stats from Supercell API...
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'war' && <WarRoom war={war} clanTag={CLAN_TAG} adminKey={adminKey} />}
            {activeTab === 'roster' && <RosterAudit members={clan?.memberList || []} />}
            {activeTab === 'capital' && <CapitalRaids clan={clan} />}
            {activeTab === 'games' && <ClanGamesView />}
            {activeTab === 'settings' && (
              <BotSettings
                config={config}
                clanTag={CLAN_TAG}
                adminKey={adminKey}
                onAdminKeyChange={handleAdminKeyChange}
                onRefreshConfig={fetchConfig}
                onSave={handleSaveConfig}
              />
            )}
          </>
        )}
      </main>

      <footer style={{ 
        borderTop: '2px solid #283547', 
        background: '#0a0e16',
        padding: '24px 20px', 
        textAlign: 'center', 
        color: 'var(--text-dim)', 
        fontSize: '0.85rem',
        boxShadow: 'inset 0 4px 8px rgba(0,0,0,0.6)'
      }}>
        <p className="font-coc" style={{ letterSpacing: '0.04em', color: '#64748b' }}>
          ⚔️ Bimgus • Clash of Clans Command Portal • Clan Bingo (#ABC123)
        </p>
      </footer>
    </div>
  );
}

export default App;
