import type { ClanData } from '../types';
import { Swords, Users, Castle, Trophy, RefreshCw, Settings, ShieldCheck, Flame } from 'lucide-react';

interface HeaderProps {
  clan: ClanData | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSync: () => void;
  isSyncing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  clan,
  activeTab,
  setActiveTab,
  onSync,
  isSyncing,
}) => {
  const tabs = [
    { id: 'war', label: 'War Room', icon: Swords },
    { id: 'roster', label: 'Clan Roster', icon: Users },
    { id: 'capital', label: 'Clan Capital', icon: Castle },
    { id: 'games', label: 'Clan Games', icon: Trophy },
    { id: 'settings', label: 'Bot Settings', icon: Settings },
  ];

  return (
    <header style={{ 
      borderBottom: '3px solid #3c2c19', 
      background: 'linear-gradient(180deg, #1b2432 0%, #111822 100%)',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.7)'
    }}>
      {/* Top Clan Profile Bar */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto', 
        padding: '20px 20px 14px', 
        display: 'flex', 
        flexWrap: 'wrap', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        gap: '20px' 
      }}>
        {/* Clan Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ position: 'relative' }}>
            <img
              src={clan?.badgeUrls?.medium || 'https://raw.githubusercontent.com/Bush1Root/Clash-of-Clans-Assets/master/Town%20Hall%20Logos/TH16.png'}
              alt="Clan Badge"
              style={{ 
                width: '74px', 
                height: '74px', 
                filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 10px rgba(245, 166, 35, 0.3))' 
              }}
            />
            <div style={{
              position: 'absolute',
              bottom: '-4px',
              right: '-4px',
              background: 'linear-gradient(180deg, #ffd700 0%, #b8860b 100%)',
              border: '2px solid #5a3d0b',
              borderRadius: '6px',
              padding: '1px 6px',
              fontFamily: 'var(--font-coc)',
              fontSize: '0.72rem',
              color: '#fff',
              textShadow: '0 1px 2px #000',
              boxShadow: '0 2px 4px rgba(0,0,0,0.6)'
            }}>
              Lvl {clan?.clanLevel || 4}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h1 className="gold-title" style={{ fontSize: '2.3rem', margin: 0, lineHeight: 1.1 }}>
                {clan?.name || 'Bingo'}
              </h1>
              <span className="coc-badge coc-badge-gold">
                <ShieldCheck size={14} /> Clan Level {clan?.clanLevel || 4}
              </span>
            </div>

            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '14px', 
              marginTop: '6px', 
              color: 'var(--text-muted)', 
              fontSize: '0.9rem',
              flexWrap: 'wrap'
            }}>
              <span style={{ 
                fontFamily: 'monospace', 
                fontWeight: 700, 
                color: 'var(--dark-elixir)', 
                background: 'rgba(6, 182, 212, 0.12)', 
                padding: '2px 8px', 
                borderRadius: '4px',
                border: '1px solid rgba(6, 182, 212, 0.3)'
              }}>
                {clan?.tag || '#ABC123'}
              </span>
              <span>•</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                <Users size={15} style={{ color: '#93c5fd' }} /> {clan?.members || 20}/50 Members
              </span>
              <span>•</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#ffb74d', fontWeight: 700 }}>
                <Flame size={15} style={{ color: '#ff9800' }} /> Streak: {clan?.warWinStreak || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Sync Button */}
        <div>
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="coc-btn coc-btn-green"
            style={{ padding: '10px 20px', fontSize: '0.9rem' }}
          >
            <RefreshCw size={16} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
            {isSyncing ? 'Syncing...' : 'Sync Clan Data'}
          </button>
        </div>
      </div>

      {/* In-Game Tab Strip */}
      <div style={{ 
        background: '#0d131d', 
        borderTop: '2px solid #283547', 
        boxShadow: 'inset 0 4px 8px rgba(0, 0, 0, 0.5)' 
      }}>
        <div style={{ 
          maxWidth: '1200px', 
          margin: '0 auto', 
          padding: '0 20px', 
          display: 'flex', 
          gap: '6px', 
          overflowX: 'auto' 
        }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 20px 10px',
                  background: isActive 
                    ? 'linear-gradient(180deg, #2b394e 0%, #1a2330 100%)' 
                    : 'transparent',
                  border: 'none',
                  borderTop: isActive ? '3px solid #ffc107' : '3px solid transparent',
                  borderLeft: isActive ? '1px solid #3d4f66' : '1px solid transparent',
                  borderRight: isActive ? '1px solid #3d4f66' : '1px solid transparent',
                  borderTopLeftRadius: '8px',
                  borderTopRightRadius: '8px',
                  color: isActive ? '#ffd700' : '#94a3b8',
                  fontFamily: 'var(--font-coc)',
                  fontSize: '1rem',
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  textShadow: isActive 
                    ? '-1px -1px 0 #3a2200, 1px -1px 0 #3a2200, -1px 1px 0 #3a2200, 1px 1px 0 #3a2200, 0 2px 0 #000' 
                    : '0 1px 2px #000',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  transform: isActive ? 'translateY(1px)' : 'none',
                  boxShadow: isActive ? 'inset 0 1px 0 rgba(255, 255, 255, 0.2)' : 'none',
                }}
              >
                <Icon size={17} style={{ color: isActive ? '#ffc107' : '#64748b' }} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </header>
  );
};
