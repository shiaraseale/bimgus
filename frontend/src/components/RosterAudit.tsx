import { useState } from 'react';
import type { Member } from '../types';
import { Search, Trophy, ArrowUpRight, ArrowDownLeft, Award } from 'lucide-react';
import { TownHallBadge } from './TownHallBadge';

interface RosterAuditProps {
  members: Member[];
}

export const RosterAudit: React.FC<RosterAuditProps> = ({ members }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'trophies' | 'th' | 'donations'>('trophies');

  const filteredMembers = members
    .filter((m) => {
      const matchSearch =
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.tag.toLowerCase().includes(searchTerm.toLowerCase());
      const matchRole = roleFilter === 'all' || m.role === roleFilter;
      return matchSearch && matchRole;
    })
    .sort((a, b) => {
      if (sortBy === 'th') return (b.townHallLevel || 0) - (a.townHallLevel || 0);
      if (sortBy === 'donations') return b.donations - a.donations;
      return b.trophies - a.trophies;
    });

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'leader':
        return <span className="coc-badge coc-badge-gold">👑 Leader</span>;
      case 'coLeader':
        return <span className="coc-badge coc-badge-purple">🛡️ Co-Leader</span>;
      case 'admin':
        return <span className="coc-badge coc-badge-blue">⚔️ Elder</span>;
      default:
        return <span className="coc-badge" style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8' }}>Member</span>;
    }
  };

  const getDonationHealth = (donated: number, received: number) => {
    if (donated === 0 && received === 0) return null;
    const ratio = received === 0 ? donated : donated / received;
    if (ratio >= 2) {
      return <span className="coc-badge coc-badge-green" style={{ fontSize: '0.7rem' }}>Top Donor</span>;
    }
    if (received > 300 && ratio < 0.2) {
      return <span className="coc-badge coc-badge-red" style={{ fontSize: '0.7rem' }}>High Leech</span>;
    }
    return <span className="coc-badge coc-badge-blue" style={{ fontSize: '0.7rem' }}>Balanced</span>;
  };

  const getRankBadgeStyle = (index: number) => {
    if (index === 0) return { background: 'linear-gradient(180deg, #ffd700 0%, #b8860b 100%)', color: '#fff', border: '1px solid #5a3e00' };
    if (index === 1) return { background: 'linear-gradient(180deg, #e2e8f0 0%, #94a3b8 100%)', color: '#1e293b', border: '1px solid #475569' };
    if (index === 2) return { background: 'linear-gradient(180deg, #d97706 0%, #78350f 100%)', color: '#fff', border: '1px solid #451a03' };
    return { background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
      {/* Search & Filter Stone Bar */}
      <div className="coc-panel" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px', 
          background: '#0e141e', 
          padding: '8px 14px', 
          borderRadius: '8px', 
          border: '2px solid #28374d', 
          minWidth: '280px',
          boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.6)'
        }}>
          <Search size={16} style={{ color: 'var(--gold)' }} />
          <input
            type="text"
            placeholder="Search member name or #tag..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: '#fff', 
              outline: 'none', 
              width: '100%', 
              fontSize: '0.92rem',
              fontWeight: 500
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{
              background: '#0e141e',
              color: '#fff',
              border: '2px solid #28374d',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '0.88rem',
              fontFamily: 'var(--font-coc)',
              letterSpacing: '0.02em',
              outline: 'none',
              cursor: 'pointer',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)'
            }}
          >
            <option value="all" style={{ background: '#0e1420' }}>All Roles</option>
            <option value="leader" style={{ background: '#0e1420' }}>Leaders</option>
            <option value="coLeader" style={{ background: '#0e1420' }}>Co-Leaders</option>
            <option value="admin" style={{ background: '#0e1420' }}>Elders</option>
            <option value="member" style={{ background: '#0e1420' }}>Members</option>
          </select>

          {/* Sort Filter */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              background: '#0e141e',
              color: '#fff',
              border: '2px solid #28374d',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '0.88rem',
              fontFamily: 'var(--font-coc)',
              letterSpacing: '0.02em',
              outline: 'none',
              cursor: 'pointer',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)'
            }}
          >
            <option value="trophies" style={{ background: '#0e1420' }}>Sort by Trophies 🏆</option>
            <option value="th" style={{ background: '#0e1420' }}>Sort by Town Hall 🏛️</option>
            <option value="donations" style={{ background: '#0e1420' }}>Sort by Donations 🎁</option>
          </select>
        </div>
      </div>

      {/* Roster Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '16px' }}>
        {filteredMembers.map((m, index) => (
          <div
            key={m.tag}
            className="coc-panel"
            style={{
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '14px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-coc)',
                    fontSize: '0.85rem',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
                    ...getRankBadgeStyle(index)
                  }}>
                    #{index + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#ffffff' }}>
                      {m.name}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--dark-elixir)' }}>
                      {m.tag}
                    </div>
                  </div>
                </div>
                <TownHallBadge level={m.townHallLevel} size={28} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {getRoleBadge(m.role)}
                {getDonationHealth(m.donations, m.donationsReceived)}
              </div>
            </div>

            {/* Inset Stats well */}
            <div
              className="coc-well"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                padding: '10px 12px',
                fontSize: '0.82rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ffb74d' }}>
                <Trophy size={14} style={{ color: '#ffc107' }} />
                <span className="font-coc">{m.trophies.toLocaleString()} 🏆</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', justifyContent: 'flex-end' }}>
                <Award size={14} style={{ color: 'var(--dark-elixir)' }} />
                <span>Rank #{index + 1}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--gem-green)', fontWeight: 600 }}>
                <ArrowUpRight size={13} />
                <span>{m.donations.toLocaleString()} given</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)', justifyContent: 'flex-end' }}>
                <ArrowDownLeft size={13} />
                <span>{m.donationsReceived.toLocaleString()} rcvd</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
