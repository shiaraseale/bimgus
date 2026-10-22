import React from 'react';
import { Trophy, Gift, Award, Flame } from 'lucide-react';

export const ClanGamesView: React.FC = () => {
  const tiers = [
    { tier: 1, points: 3000, label: 'Tier 1' },
    { tier: 2, points: 7500, label: 'Tier 2' },
    { tier: 3, points: 12000, label: 'Tier 3' },
    { tier: 4, points: 18000, label: 'Tier 4' },
    { tier: 5, points: 30000, label: 'Tier 5' },
    { tier: 6, points: 50000, label: 'Tier 6 (Max Rewards)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
      {/* Clan Games Caravan Banner */}
      <div className="coc-panel coc-panel-gold" style={{ padding: '28px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span className="coc-badge coc-badge-gold" style={{ marginBottom: '10px' }}>
              <Trophy size={15} /> Monthly Event (22nd – 28th)
            </span>
            <h2 className="gold-title" style={{ fontSize: '2.1rem', margin: '8px 0 6px', lineHeight: 1.1 }}>
              Clan Games Caravan
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
              Individual Max Cap: <strong style={{ color: 'var(--gold-bright)' }}>4,000 Points</strong> • Clan Goal: <strong style={{ color: 'var(--gem-green)' }}>50,000 Points</strong>
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="coc-badge coc-badge-purple" style={{ fontSize: '0.88rem' }}>
              <Gift size={16} /> All Tiers Tracked Live
            </span>
          </div>
        </div>
      </div>

      {/* Reward Tier Milestones */}
      <h3 className="gold-title" style={{ fontSize: '1.4rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Award size={20} style={{ color: 'var(--dark-elixir)' }} />
        Reward Tier Milestones
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px' }}>
        {tiers.map((t) => {
          const isMax = t.tier === 6;
          return (
            <div
              key={t.tier}
              className={`coc-panel ${isMax ? 'coc-panel-gold' : ''}`}
              style={{
                padding: '22px',
                borderLeft: isMax ? '5px solid #ffc107' : '5px solid #3d4f66',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span className="font-coc" style={{ 
                  fontSize: '1.25rem', 
                  color: isMax ? '#ffd700' : '#ffffff',
                  textShadow: '0 1px 2px #000'
                }}>
                  {t.label}
                </span>
                <span className="coc-badge coc-badge-gold" style={{ fontSize: '0.78rem' }}>
                  {t.points.toLocaleString()} pts
                </span>
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
                {isMax 
                  ? 'Unlocks bonus extra reward slot for 4k max point contributors!' 
                  : 'Unlocks clan magic items, potions, and resource rewards.'}
              </p>
              <div className="coc-well" style={{ 
                marginTop: '14px', 
                padding: '8px 12px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                fontSize: '0.8rem',
                color: '#94a3b8'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Flame size={14} style={{ color: 'var(--gold)' }} /> Goal
                </span>
                <span className="font-coc" style={{ color: isMax ? '#ffd700' : '#fff' }}>
                  {t.points.toLocaleString()} Points
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
