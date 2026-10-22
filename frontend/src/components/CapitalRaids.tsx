import type { ClanData } from '../types';
import { Castle, Coins, ShieldCheck, Flame } from 'lucide-react';

interface CapitalRaidsProps {
  clan: ClanData | null;
}

export const CapitalRaids: React.FC<CapitalRaidsProps> = ({ clan }) => {
  const capital = clan?.clanCapital;
  const districts = capital?.districts || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
      {/* Capital Peak Overview Banner */}
      <div className="coc-panel coc-panel-gold" style={{ padding: '28px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div style={{ 
              width: '64px', 
              height: '64px', 
              borderRadius: '12px', 
              background: 'linear-gradient(180deg, #ffca28 0%, #ff8f00 100%)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              border: '3px solid #5a3800',
              boxShadow: '0 4px 10px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,255,255,0.5)'
            }}>
              <Castle size={36} style={{ color: '#fff' }} />
            </div>
            <div>
              <h2 className="gold-title" style={{ fontSize: '1.9rem', margin: 0, lineHeight: 1.1 }}>
                Clan Capital Peak
              </h2>
              <div style={{ color: 'var(--text-gold)', fontSize: '0.95rem', fontWeight: 600, marginTop: '4px' }}>
                Capital Hall Level {capital?.capitalHallLevel || 3}
              </div>
            </div>
          </div>
          <span className="coc-badge coc-badge-gold" style={{ fontSize: '0.85rem' }}>
            <ShieldCheck size={16} /> Active Weekend Raids
          </span>
        </div>
      </div>

      {/* Districts Grid Heading */}
      <h3 className="gold-title" style={{ fontSize: '1.4rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Flame size={20} style={{ color: 'var(--gold)' }} />
        Unlocked Capital Districts ({districts.length})
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '18px' }}>
        {districts.map((d) => (
          <div key={d.id} className="coc-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 className="font-coc" style={{ fontSize: '1.2rem', color: '#fff', margin: 0 }}>
                {d.name}
              </h4>
              <span className="coc-badge coc-badge-gold" style={{ fontSize: '0.75rem' }}>
                Hall Level {d.districtHallLevel}
              </span>
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.4 }}>
              District operational and contributing to raid weekend defense and offense rewards.
            </p>
            <div className="coc-well" style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '10px 14px',
              color: '#ffca28', 
              fontSize: '0.88rem',
              fontWeight: 700
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Coins size={16} style={{ color: '#ffb300' }} /> 5 + 1 Bonus Hits
              </span>
              <span className="coc-badge coc-badge-green" style={{ fontSize: '0.7rem' }}>
                Active
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
