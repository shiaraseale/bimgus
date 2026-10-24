import { useState } from 'react';
import { readStoredKey } from '../storage';
import type { WarData } from '../types';
import { Swords, ShieldAlert, Star, BellRing, Clock } from 'lucide-react';
import { TownHallBadge } from './TownHallBadge';

interface WarRoomProps {
  war: WarData | null;
  clanTag: string;
  adminKey?: string;
}

export const WarRoom: React.FC<WarRoomProps> = ({ war, clanTag, adminKey }) => {
  const effectiveKey = adminKey || readStoredKey();
  const [isNudging, setIsNudging] = useState(false);
  const [nudgeMessage, setNudgeMessage] = useState<string | null>(null);

  if (!war || war.state === 'notInWar') {
    return (
      <div className="coc-panel" style={{ padding: '60px 20px', textAlign: 'center', marginTop: '24px' }}>
        <Swords size={56} style={{ color: '#64748b', marginBottom: '16px' }} />
        <h3 className="gold-title" style={{ fontSize: '1.8rem', marginBottom: '8px' }}>
          Not Currently in War
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          The clan is currently not participating in an active clan war.
        </p>
      </div>
    );
  }

  const clan = war.clan;
  const opponent = war.opponent;
  // Regular wars allow 2 attacks each; CWL allows 1 (the API sends attacksPerMember for regular wars)
  const attacksPerMember = war.attacksPerMember || (war.isCwl ? 1 : 2);
  const teamSize = war.teamSize || clan.members.length || 15;

  // Unused attacks list
  const unusedAttackers = clan.members.filter((m) => {
    const used = m.attacks ? m.attacks.length : 0;
    return used < attacksPerMember;
  });

  // Flatten and sort all attacks by order
  const allAttacks: Array<{
    order: number;
    attackerName: string;
    attackerPos: number;
    attackerTH: number;
    defenderName: string;
    defenderPos: number;
    defenderTH: number;
    stars: number;
    destruction: number;
    duration?: number;
    isClanAttack: boolean;
  }> = [];

  const oppMap = new Map(opponent.members.map((m) => [m.tag, m]));
  const clanMap = new Map(clan.members.map((m) => [m.tag, m]));

  clan.members.forEach((m) => {
    m.attacks?.forEach((a) => {
      const def = oppMap.get(a.defenderTag);
      allAttacks.push({
        order: a.order,
        attackerName: m.name,
        attackerPos: m.mapPosition,
        attackerTH: m.townhallLevel,
        defenderName: def?.name || 'Opponent',
        defenderPos: def?.mapPosition || 0,
        defenderTH: def?.townhallLevel || 0,
        stars: a.stars,
        destruction: a.destructionPercentage,
        duration: a.duration,
        isClanAttack: true,
      });
    });
  });

  opponent.members.forEach((m) => {
    m.attacks?.forEach((a) => {
      const def = clanMap.get(a.defenderTag);
      allAttacks.push({
        order: a.order,
        attackerName: m.name,
        attackerPos: m.mapPosition,
        attackerTH: m.townhallLevel,
        defenderName: def?.name || 'Teammate',
        defenderPos: def?.mapPosition || 0,
        defenderTH: def?.townhallLevel || 0,
        stars: a.stars,
        destruction: a.destructionPercentage,
        duration: a.duration,
        isClanAttack: false,
      });
    });
  });

  allAttacks.sort((a, b) => b.order - a.order); // newest first

  // Chronological best stars on opponent bases to detect wasted attacks
  const oppBestStars = new Map<string, number>();
  const wastedClanAttacks: Array<{
    attackerName: string;
    attackerPos: number;
    defenderName: string;
    defenderPos: number;
    stars: number;
    destruction: number;
  }> = [];

  const clanAttacksAsc = [...allAttacks.filter((a) => a.isClanAttack)].sort((a, b) => a.order - b.order);
  clanAttacksAsc.forEach((atk) => {
    const prevBest = oppBestStars.get(atk.defenderName) || 0;
    if (prevBest === 3) {
      wastedClanAttacks.push({
        attackerName: atk.attackerName,
        attackerPos: atk.attackerPos,
        defenderName: atk.defenderName,
        defenderPos: atk.defenderPos,
        stars: atk.stars,
        destruction: atk.destruction,
      });
    }
    if (atk.stars > prevBest) {
      oppBestStars.set(atk.defenderName, atk.stars);
    }
  });

  const handleNudge = async () => {
    if (!effectiveKey) return;
    setIsNudging(true);
    setNudgeMessage(null);
    try {
      const res = await fetch(`/api/clan/${encodeURIComponent(clanTag)}/poll`, {
        method: 'POST',
        headers: {
          'X-Admin-Key': effectiveKey,
        },
      });
      const data = await res.json();
      if (data.success) {
        setNudgeMessage('✅ War check synced and reminder triggered if eligible!');
      } else {
        setNudgeMessage(`Sync error: ${data.error || 'Failed to sync'}`);
      }
    } catch {
      setNudgeMessage('Could not reach bot API');
    } finally {
      setIsNudging(false);
      setTimeout(() => setNudgeMessage(null), 4000);
    }
  };

  const isPrep = war.state === 'preparation';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
      {/* In-Game War Scoreboard Card */}
      <div className="coc-panel coc-panel-gold" style={{ padding: '28px 24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <span className="coc-badge coc-badge-gold" style={{ fontSize: '0.85rem' }}>
            <Swords size={16} />{' '}
            {isPrep ? '⏳ Preparation Day Active' : war.state === 'inWar' ? '🔥 Battle Day Live' : '🏁 War Ended'}
          </span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#cbd5e1',
              fontFamily: 'var(--font-coc)',
              fontSize: '0.95rem',
            }}
          >
            <Clock size={16} style={{ color: 'var(--gold)' }} /> Format: {teamSize} vs {teamSize} (
            {teamSize * attacksPerMember} Hits Total)
          </div>
        </div>

        {/* The VS War Clash Arena */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            gap: '24px',
            textAlign: 'center',
            background: 'rgba(9, 14, 22, 0.65)',
            padding: '24px 18px',
            borderRadius: '12px',
            border: '2px solid #28374d',
            boxShadow: 'inset 0 3px 10px rgba(0, 0, 0, 0.8)',
          }}
        >
          {/* Friendly Clan (Blue Shield) */}
          <div style={{ padding: '0 10px' }}>
            <h2
              className="font-coc"
              style={{ fontSize: '1.8rem', color: '#93c5fd', margin: 0, textShadow: '0 2px 4px #000' }}
            >
              {clan.name}
            </h2>
            <div
              className="font-coc"
              style={{
                fontSize: '3rem',
                color: '#ffd700',
                margin: '6px 0',
                textShadow: 'var(--text-shadow-coc)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              {clan.stars} <Star size={30} style={{ fill: '#ffd700', color: '#ffb300' }} />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
              {clan.attacks} / {teamSize * attacksPerMember} Attacks
            </div>
            {/* 3D Progress Bar */}
            <div className="coc-progress-track" style={{ marginTop: '12px' }}>
              <div className="coc-progress-fill-blue" style={{ width: `${clan.destructionPercentage}%` }} />
            </div>
            <div
              className="font-coc"
              style={{ fontSize: '0.92rem', color: '#93c5fd', marginTop: '6px', textShadow: '0 1px 2px #000' }}
            >
              {clan.destructionPercentage.toFixed(1)}% Destruction
            </div>
          </div>

          {/* Golden 3D VS Shield */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: 'linear-gradient(180deg, #ffca28 0%, #ff8f00 100%)',
                border: '3px solid #5a3800',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.8), inset 0 2px 0 rgba(255, 255, 255, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-coc)',
                fontSize: '1.4rem',
                color: '#fff',
                textShadow: '0 2px 2px #5a3800',
                letterSpacing: '0.04em',
              }}
            >
              VS
            </div>
          </div>

          {/* Enemy Clan (Red Shield) */}
          <div style={{ padding: '0 10px' }}>
            <h2
              className="font-coc"
              style={{ fontSize: '1.8rem', color: '#fca5a5', margin: 0, textShadow: '0 2px 4px #000' }}
            >
              {opponent.name}
            </h2>
            <div
              className="font-coc"
              style={{
                fontSize: '3rem',
                color: '#f87171',
                margin: '6px 0',
                textShadow: 'var(--text-shadow-coc)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              {opponent.stars} <Star size={30} style={{ fill: '#f87171', color: '#b91c1c' }} />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
              {opponent.attacks} / {teamSize * attacksPerMember} Attacks
            </div>
            {/* 3D Progress Bar */}
            <div className="coc-progress-track" style={{ marginTop: '12px' }}>
              <div className="coc-progress-fill-red" style={{ width: `${opponent.destructionPercentage}%` }} />
            </div>
            <div
              className="font-coc"
              style={{ fontSize: '0.92rem', color: '#fca5a5', marginTop: '6px', textShadow: '0 1px 2px #000' }}
            >
              {opponent.destructionPercentage.toFixed(1)}% Destruction
            </div>
          </div>
        </div>
      </div>

      {/* War Tactical Audit Wells */}
      <div className="coc-panel" style={{ padding: '24px' }}>
        <h3
          className="gold-title"
          style={{ fontSize: '1.35rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}
        >
          <ShieldAlert size={22} style={{ color: 'var(--gold)' }} />
          War Discipline & Tactical Audit
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          {/* Missed Attacks Well */}
          <div className="coc-well" style={{ padding: '16px' }}>
            <div
              className="font-coc"
              style={{
                fontSize: '1.05rem',
                color: '#f87171',
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              🚨 Unused Attacks ({unusedAttackers.length})
            </div>
            {unusedAttackers.length === 0 ? (
              <p style={{ fontSize: '0.88rem', color: 'var(--gem-green)', fontWeight: 600 }}>
                ✅ Flawless! All players have used all their attacks.
              </p>
            ) : (
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}
              >
                {unusedAttackers.map((m) => {
                  const used = m.attacks ? m.attacks.length : 0;
                  return (
                    <div
                      key={m.tag}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.88rem',
                        padding: '6px 10px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '6px',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        #{m.mapPosition} {m.name}
                      </span>
                      <TownHallBadge
                        level={m.townhallLevel}
                        size={20}
                        fontSize="0.72rem"
                        style={{ padding: '2px 6px' }}
                      />
                      <span className="coc-badge coc-badge-red" style={{ fontSize: '0.72rem' }}>
                        {used}/2 ({2 - used} left)
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Wasted Attacks on Already 3-Starred Bases */}
          <div className="coc-well" style={{ padding: '16px' }}>
            <div
              className="font-coc"
              style={{
                fontSize: '1.05rem',
                color: '#ffb300',
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              🎯 Hit Already 3-Starred Bases ({wastedClanAttacks.length})
            </div>
            {wastedClanAttacks.length === 0 ? (
              <p style={{ fontSize: '0.88rem', color: 'var(--gem-green)', fontWeight: 600 }}>
                ✅ 100% efficient targeting! No attacks wasted on 3⭐ bases.
              </p>
            ) : (
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}
              >
                {wastedClanAttacks.map((w, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.88rem',
                      padding: '6px 10px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '6px',
                    }}
                  >
                    <span>
                      #{w.attackerPos} {w.attackerName} ➔ #{w.defenderPos} {w.defenderName}
                    </span>
                    <span className="coc-badge coc-badge-gold" style={{ fontSize: '0.7rem' }}>
                      Was Already 3 ⭐
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid: Pending Attacks & Recent Attacks Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        {/* Pending Attacks Card */}
        <div className="coc-panel" style={{ padding: '24px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <h3
              className="gold-title"
              style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <ShieldAlert size={20} style={{ color: 'var(--gold)' }} />
              Pending Attacks ({unusedAttackers.length})
            </h3>
            {effectiveKey && (
              <button
                onClick={handleNudge}
                disabled={isNudging}
                className="coc-btn coc-btn-yellow"
                style={{ padding: '6px 14px', fontSize: '0.8rem' }}
              >
                <BellRing size={14} />
                {isNudging ? 'Pinging...' : 'Nudge In Discord'}
              </button>
            )}
          </div>

          {nudgeMessage && (
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '2px solid var(--gem-green)',
                borderRadius: '8px',
                fontSize: '0.88rem',
                marginBottom: '14px',
                fontFamily: 'var(--font-coc)',
                color: '#bbf7d0',
              }}
            >
              {nudgeMessage}
            </div>
          )}

          {unusedAttackers.length === 0 ? (
            <p style={{ color: 'var(--gem-green)', fontSize: '0.95rem', fontWeight: 600 }}>
              🎉 All clan members have used all their attacks!
            </p>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '380px', overflowY: 'auto' }}
            >
              {unusedAttackers.map((m) => {
                const used = m.attacks ? m.attacks.length : 0;
                return (
                  <div
                    key={m.tag}
                    className="coc-well"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <TownHallBadge level={m.townhallLevel} size={22} fontSize="0.78rem" />
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>
                        #{m.mapPosition} {m.name}
                      </span>
                    </div>
                    <span className="coc-badge coc-badge-red" style={{ fontSize: '0.75rem' }}>
                      {used}/2 Used
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Attack Feed Card */}
        <div className="coc-panel" style={{ padding: '24px' }}>
          <h3
            className="gold-title"
            style={{ fontSize: '1.25rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Swords size={20} style={{ color: 'var(--dark-elixir)' }} />
            War Attack Events ({allAttacks.length})
          </h3>

          {allAttacks.length === 0 ? (
            <div className="coc-well" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Clock size={28} style={{ color: 'var(--gold)', marginBottom: '8px' }} />
              <p style={{ margin: 0, fontWeight: 600 }}>
                {isPrep ? 'No attacks yet — War is in Preparation Day.' : 'Waiting for the first war attack to land!'}
              </p>
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '380px', overflowY: 'auto' }}
            >
              {allAttacks.map((atk, i) => (
                <div
                  key={i}
                  className="coc-well"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderLeft: atk.isClanAttack ? '4px solid var(--gem-green)' : '4px solid var(--war-red)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>
                      #{atk.attackerPos} {atk.attackerName} ➔ #{atk.defenderPos} {atk.defenderName}
                    </div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-dim)',
                        marginTop: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <TownHallBadge
                        level={atk.attackerTH}
                        size={18}
                        fontSize="0.7rem"
                        style={{ padding: '1px 6px' }}
                      />
                      <span>vs</span>
                      <TownHallBadge
                        level={atk.defenderTH}
                        size={18}
                        fontSize="0.7rem"
                        style={{ padding: '1px 6px' }}
                      />
                      {atk.duration ? <span>• {atk.duration}s</span> : null}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      className="font-coc"
                      style={{
                        color: atk.stars === 3 ? '#ffd700' : '#fff',
                        fontSize: '1.05rem',
                        letterSpacing: '2px',
                        textShadow: '0 1px 2px #000',
                      }}
                    >
                      {'⭐'.repeat(atk.stars)}
                    </div>
                    <div className="font-coc" style={{ fontSize: '0.85rem', color: '#ffb300', marginTop: '2px' }}>
                      {atk.destruction}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
