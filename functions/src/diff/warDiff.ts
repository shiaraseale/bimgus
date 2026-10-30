import { CurrentWarResponse, WarAttack, WarClan, WarClanMember } from '../types/coc';
import { WarSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordButtonComponent, DiscordContainerComponent } from '../types/discord';
import { card, fitLines, layoutMessage } from '../services/discordLayout';
import { EMOJIS } from '../constants/emojis';
import { discordTime } from '../utils/discordTime';
import type { WarAudit } from '../types/api';

// Room for the post-war audit's lists (Discord allows 4,000 characters per message)
const AUDIT_BUDGET = 3500;
// Room for a matchup's lineup, under its header (a 50v50 war fits)
const LINEUP_BUDGET = 3300;

export interface FlatAttack extends WarAttack {
  isClanAttack: boolean;
  attacker: WarClanMember;
  defender: WarClanMember;
}

interface ClanScore {
  stars: number;
  destructionPercentage: number;
}

/** Members as "#3 Alice, #7 Bob", in map order. */
export function positionList(members: Array<{ mapPosition: number; name: string }>): string {
  return [...members]
    .sort((a, b) => a.mapPosition - b.mapPosition)
    .map((m) => `#${m.mapPosition} ${m.name}`)
    .join(', ');
}

/**
 * The lineup, one map position a line with our player and their mirror:
 * "` 1` Avery (TH15) vs Rival 1 (TH15)". Empty when the war has no members listed.
 */
export function lineupBlock(ours: WarClan, theirs: WarClan): string {
  const byPosition = (clan: WarClan) => new Map(clan.members.map((m) => [m.mapPosition, m]));
  const us = byPosition(ours);
  const them = byPosition(theirs);
  const who = (m?: WarClanMember) => (m ? `${m.name} (TH${m.townhallLevel})` : '–');
  const size = Math.max(ours.members.length, theirs.members.length);
  if (size === 0) return '';
  const lines = Array.from(
    { length: size },
    (_, i) => `\`${String(i + 1).padStart(2, ' ')}\` ${who(us.get(i + 1))} vs ${who(them.get(i + 1))}`
  );
  return [`**${ours.name}** vs **${theirs.name}**`, ...fitLines(lines, LINEUP_BUDGET)].join('\n');
}

/** "12–10 ⭐ · 45.0% vs 38.2%", ours first. */
export function scoreLine(ours: ClanScore, theirs: ClanScore): string {
  return `${ours.stars}–${theirs.stars} ${EMOJIS.STAR} · ${ours.destructionPercentage.toFixed(1)}% vs ${theirs.destructionPercentage.toFixed(1)}%`;
}

/** One attack in a war or CWL round, ours or theirs: the result, who hit whom, then the live score. */
export function buildAttackCard(
  attack: FlatAttack,
  ours: ClanScore,
  theirs: ClanScore,
  buttons: DiscordButtonComponent[],
  context?: string // e.g. "CWL round 3 · 10/15 attacks", at the end of the footer
): DiscordContainerComponent {
  const { attacker, defender, isClanAttack } = attack;
  const isThreeStar = attack.stars === 3;
  return card({
    accent: isClanAttack ? (isThreeStar ? COLORS.GOLD : COLORS.GREEN) : isThreeStar ? COLORS.RED : COLORS.BLUE,
    title: `${isClanAttack ? '💥 Clan attack' : '🛡️ Enemy attack'}: ${DiscordService.formatStars(attack.stars)} ${attack.destructionPercentage}%`,
    body: `**#${attacker.mapPosition} ${attacker.name}** (TH${attacker.townhallLevel}) → **#${defender.mapPosition} ${defender.name}** (TH${defender.townhallLevel})`,
    footer: [`Score ${scoreLine(ours, theirs)}`, context].filter(Boolean).join(' · '),
    buttons,
  });
}

export function getWarId(currentWar: CurrentWarResponse): string {
  return `${currentWar.clan.tag}_${currentWar.opponent.tag}_${currentWar.preparationStartTime || currentWar.startTime || 'pending'}`;
}

export async function processWarDiff(
  currentWar: CurrentWarResponse,
  prevSnapshot: WarSnapshotDoc | null,
  config: BotConfigDoc
): Promise<WarSnapshotDoc | null> {
  if (currentWar.state === 'notInWar') {
    return null;
  }

  const warId = getWarId(currentWar);
  const webhookUrl = config.webhooks.warRoom;
  const isSameWar = Boolean(prevSnapshot && prevSnapshot.warId === warId);
  const isNewWar = !isSameWar;
  const loggedOrders = new Set<number>(isSameWar ? prevSnapshot?.loggedAttackOrders || [] : []);
  let matchupAnnounced = isSameWar ? Boolean(prevSnapshot?.matchupAnnounced) : false;

  // 1. Announce War Matchup if it hasn't been announced yet
  if (!matchupAnnounced && webhookUrl && (currentWar.state === 'preparation' || currentWar.state === 'inWar')) {
    await DiscordService.sendWebhook(webhookUrl, layoutMessage(buildWarMatchupCard(currentWar)));
    matchupAnnounced = true;
  }

  // 2. Map all attacks to find new ones
  const clanMembersMap = new Map<string, WarClanMember>(currentWar.clan.members.map((m) => [m.tag, m]));
  const oppMembersMap = new Map<string, WarClanMember>(currentWar.opponent.members.map((m) => [m.tag, m]));

  const allAttacks: FlatAttack[] = [];

  // Clan Attacks
  for (const m of currentWar.clan.members) {
    if (m.attacks) {
      for (const atk of m.attacks) {
        const defender =
          oppMembersMap.get(atk.defenderTag) ||
          ({ name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 } as WarClanMember);
        allAttacks.push({
          ...atk,
          isClanAttack: true,
          attacker: m,
          defender,
        });
      }
    }
  }

  // Opponent Attacks
  for (const m of currentWar.opponent.members) {
    if (m.attacks) {
      for (const atk of m.attacks) {
        const defender =
          clanMembersMap.get(atk.defenderTag) ||
          ({ name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 } as WarClanMember);
        allAttacks.push({
          ...atk,
          isClanAttack: false,
          attacker: m,
          defender,
        });
      }
    }
  }

  // Sort by attack order
  allAttacks.sort((a, b) => a.order - b.order);

  // 3. Process new attacks
  if (webhookUrl && config.notificationsEnabled.warAttacks && currentWar.state === 'inWar') {
    if (isNewWar) {
      // Establish baseline for existing war without spamming historical attacks
      for (const a of allAttacks) {
        loggedOrders.add(a.order);
      }
    } else {
      const newAttacks = allAttacks.filter((a) => !loggedOrders.has(a.order));

      for (const attack of newAttacks) {
        const attackCard = buildAttackCard(
          attack,
          currentWar.clan,
          currentWar.opponent,
          DiscordService.warActionRow(currentWar.clan.tag, currentWar.opponent.tag).components
        );
        await DiscordService.sendWebhook(webhookUrl, layoutMessage(attackCard));
        loggedOrders.add(attack.order);
        // Small delay to maintain gentle pacing
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  } else {
    // If notifications disabled, mark all current attacks as logged
    for (const a of allAttacks) {
      loggedOrders.add(a.order);
    }
  }

  const { postWarAudit } = buildWarEndSummary(currentWar);

  // 4. War Ended Announcement
  // Only for a war the bot saw before it ended, so a first run (or a fresh deploy) doesn't post an old war
  if (
    currentWar.state === 'warEnded' &&
    isSameWar &&
    prevSnapshot?.state !== 'warEnded' &&
    webhookUrl &&
    config.notificationsEnabled.warEndSummary
  ) {
    await sendWarSummaryDiscord(webhookUrl, currentWar);
  }

  return {
    warId,
    state: currentWar.state,
    startTime: currentWar.startTime,
    endTime: currentWar.endTime,
    preparationStartTime: currentWar.preparationStartTime,
    clanTag: currentWar.clan.tag,
    clanName: currentWar.clan.name,
    clanStars: currentWar.clan.stars,
    clanDestruction: currentWar.clan.destructionPercentage,
    clanAttacksCount: currentWar.clan.attacks,
    opponentTag: currentWar.opponent.tag,
    opponentName: currentWar.opponent.name,
    opponentStars: currentWar.opponent.stars,
    opponentDestruction: currentWar.opponent.destructionPercentage,
    opponentAttacksCount: currentWar.opponent.attacks,
    loggedAttackOrders: Array.from(loggedOrders),
    pingedMissedAttacks: isSameWar ? Boolean(prevSnapshot?.pingedMissedAttacks) : false,
    matchupAnnounced,
    rosterNotified: isSameWar ? Boolean(prevSnapshot?.rosterNotified) : false,
    postWarAudit,
    members: currentWar.clan.members,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Supercell ISO format converter (e.g. 20260928T180000.000Z -> ISO)
 */
export function formatCoCTime(cocTime: string): string {
  if (!cocTime) return '';
  if (cocTime.includes('-')) return cocTime;
  return cocTime.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?Z?$/,
    (_match, y, mo, d, h, mi, s, ms) => {
      const millis = ms ? `.${ms}` : '.000';
      return `${y}-${mo}-${d}T${h}:${mi}:${s}${millis}Z`;
    }
  );
}

/** The war's opponent and schedule, posted once when the bot first sees the war. */
function buildWarMatchupCard(currentWar: CurrentWarResponse): DiscordContainerComponent {
  const startMs = currentWar.startTime ? new Date(formatCoCTime(currentWar.startTime)).getTime() : null;
  const endMs = currentWar.endTime ? new Date(formatCoCTime(currentWar.endTime)).getTime() : null;
  const isPrep = currentWar.state === 'preparation';
  const { opponent, teamSize } = currentWar;

  return card({
    accent: isPrep ? COLORS.PURPLE : COLORS.GOLD,
    title: `${isPrep ? '⚔️ War declared' : '🔥 Battle day'}: vs ${opponent.name}`,
    body: [
      `${teamSize}v${teamSize} · clan level ${opponent.clanLevel}`,
      isPrep && startMs ? `Battle day ${discordTime(startMs)}` : '',
      endMs ? `Ends ${discordTime(endMs)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    thumbnail: opponent.badgeUrls?.large || opponent.badgeUrls?.medium || opponent.badgeUrls?.small,
    blocks: [lineupBlock(currentWar.clan, opponent)],
    footer: opponent.tag,
    buttons: DiscordService.warActionRow(currentWar.clan.tag, opponent.tag).components,
  });
}

export interface WarEndSummaryResult {
  summaryCard: DiscordContainerComponent;
  postWarAudit: WarAudit;
}

export function buildWarEndSummary(currentWar: CurrentWarResponse): WarEndSummaryResult {
  const attacksPerMember = 2;
  const allAttacks: FlatAttack[] = [];
  const clanMap = new Map<string, WarClanMember>(currentWar.clan.members.map((m) => [m.tag, m]));
  const oppMap = new Map<string, WarClanMember>(currentWar.opponent.members.map((m) => [m.tag, m]));

  for (const m of currentWar.clan.members) {
    if (m.attacks) {
      for (const atk of m.attacks) {
        allAttacks.push({
          ...atk,
          isClanAttack: true,
          attacker: m,
          defender: oppMap.get(atk.defenderTag) || {
            name: 'Unknown',
            mapPosition: 0,
            tag: atk.defenderTag,
            townhallLevel: 0,
          },
        });
      }
    }
  }

  for (const m of currentWar.opponent.members) {
    if (m.attacks) {
      for (const atk of m.attacks) {
        allAttacks.push({
          ...atk,
          isClanAttack: false,
          attacker: m,
          defender: clanMap.get(atk.defenderTag) || {
            name: 'Unknown',
            mapPosition: 0,
            tag: atk.defenderTag,
            townhallLevel: 0,
          },
        });
      }
    }
  }

  const oppBestStars = new Map<string, { stars: number; attackerName: string; order: number }>();
  const wastedAttacks: Array<{
    attackerName: string;
    attackerPos: number;
    defenderName: string;
    defenderPos: number;
    stars: number;
    destruction: number;
  }> = [];

  const clanAttacksSorted = allAttacks.filter((a) => a.isClanAttack).sort((a, b) => a.order - b.order);

  for (const atk of clanAttacksSorted) {
    const prevBest = oppBestStars.get(atk.defender.tag);
    if (prevBest && prevBest.stars === 3) {
      wastedAttacks.push({
        attackerName: atk.attacker.name,
        attackerPos: atk.attacker.mapPosition,
        defenderName: atk.defender.name,
        defenderPos: atk.defender.mapPosition,
        stars: atk.stars,
        destruction: atk.destructionPercentage,
      });
    }
    if (!prevBest || atk.stars > prevBest.stars) {
      oppBestStars.set(atk.defender.tag, {
        stars: atk.stars,
        attackerName: atk.attacker.name,
        order: atk.order,
      });
    }
  }

  const zeroAttacks: Array<{ tag: string; name: string; mapPosition: number; townhallLevel: number }> = [];
  const partialAttacks: Array<{
    tag: string;
    name: string;
    mapPosition: number;
    townhallLevel: number;
    attacksUsed: number;
    starsGained: number;
  }> = [];
  const mvps: Array<{
    name: string;
    mapPosition: number;
    townhallLevel: number;
    totalStars: number;
    avgDestruction: number;
  }> = [];

  for (const m of currentWar.clan.members) {
    const used = m.attacks ? m.attacks.length : 0;
    const starsGained = (m.attacks || []).reduce((acc, a) => acc + a.stars, 0);
    const totalDestruction = (m.attacks || []).reduce((acc, a) => acc + a.destructionPercentage, 0);

    if (used === 0) {
      zeroAttacks.push({ tag: m.tag, name: m.name, mapPosition: m.mapPosition, townhallLevel: m.townhallLevel });
    } else if (used < attacksPerMember) {
      partialAttacks.push({
        tag: m.tag,
        name: m.name,
        mapPosition: m.mapPosition,
        townhallLevel: m.townhallLevel,
        attacksUsed: used,
        starsGained,
      });
    } else if (used === attacksPerMember && starsGained === attacksPerMember * 3) {
      mvps.push({
        name: m.name,
        mapPosition: m.mapPosition,
        townhallLevel: m.townhallLevel,
        totalStars: starsGained,
        avgDestruction: totalDestruction / used,
      });
    }
  }

  const postWarAudit = {
    zeroAttacks,
    partialAttacks,
    wastedAttacks,
    mvps,
  };

  const won =
    currentWar.clan.stars > currentWar.opponent.stars ||
    (currentWar.clan.stars === currentWar.opponent.stars &&
      currentWar.clan.destructionPercentage > currentWar.opponent.destructionPercentage);
  const tied =
    currentWar.clan.stars === currentWar.opponent.stars &&
    currentWar.clan.destructionPercentage === currentWar.opponent.destructionPercentage;

  const outcome = won ? '🏆 War won' : tied ? '🤝 War tied' : '💀 War lost';
  const outcomeColor = won ? COLORS.GOLD : tied ? COLORS.BLUE : COLORS.RED;

  // The audit: one line per kind of finding, naming the members
  const auditLines: string[] = [];
  if (zeroAttacks.length > 0) auditLines.push(`🚨 **No attacks**: ${positionList(zeroAttacks)}`);
  if (partialAttacks.length > 0) {
    auditLines.push(`⚠️ **1 of ${attacksPerMember} attacks**: ${positionList(partialAttacks)}`);
  }
  if (zeroAttacks.length === 0 && partialAttacks.length === 0) auditLines.push('✅ Everyone used every attack');
  if (wastedAttacks.length > 0) {
    const wasted = wastedAttacks.map((w) => `#${w.attackerPos} ${w.attackerName} on #${w.defenderPos}`).join(', ');
    auditLines.push(`🎯 **Hit a base already at 3 ${EMOJIS.STAR}**: ${wasted}`);
  }
  if (mvps.length > 0) auditLines.push(`${EMOJIS.STAR} **All ${attacksPerMember * 3} stars**: ${positionList(mvps)}`);

  const summaryCard = card({
    accent: outcomeColor,
    title: `${outcome} vs ${currentWar.opponent.name}`,
    body: [
      scoreLine(currentWar.clan, currentWar.opponent),
      `🗡️ Attacks used: ${currentWar.clan.attacks}/${currentWar.teamSize * attacksPerMember} vs ${currentWar.opponent.attacks}/${currentWar.teamSize * attacksPerMember}`,
    ].join('\n'),
    // A big war's lists are trimmed to fit the message
    blocks: [fitLines(auditLines, AUDIT_BUDGET).join('\n')],
    buttons: DiscordService.warActionRow(currentWar.clan.tag, currentWar.opponent.tag).components,
  });

  return { summaryCard, postWarAudit };
}

export async function sendWarSummaryDiscord(webhookUrl: string, currentWar: CurrentWarResponse): Promise<boolean> {
  return DiscordService.sendWebhook(webhookUrl, layoutMessage(buildWarEndSummary(currentWar).summaryCard));
}
