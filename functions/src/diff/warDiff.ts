import { CurrentWarResponse, WarAttack, WarClanMember } from '../types/coc';
import { WarSnapshotDoc, BotConfigDoc } from '../types/db';
import { DiscordService, COLORS } from '../services/discordService';
import { DiscordEmbed } from '../types/discord';
import { EMOJIS } from '../constants/emojis';

interface FlatAttack extends WarAttack {
  isClanAttack: boolean;
  attacker: WarClanMember;
  defender: WarClanMember;
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
  const loggedOrders = new Set<number>(isSameWar ? (prevSnapshot?.loggedAttackOrders || []) : []);
  let matchupAnnounced = isSameWar ? Boolean(prevSnapshot?.matchupAnnounced) : false;

  // 1. Announce War Matchup if it hasn't been announced yet
  if (!matchupAnnounced && webhookUrl && (currentWar.state === 'preparation' || currentWar.state === 'inWar')) {
    const embed = buildWarMatchupEmbed(currentWar);
    await DiscordService.sendWebhook(webhookUrl, {
      embeds: [embed],
      components: [DiscordService.warActionRow(currentWar.clan.tag, currentWar.opponent.tag)],
    });
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
        const defender = oppMembersMap.get(atk.defenderTag) || ({ name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 } as WarClanMember);
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
        const defender = clanMembersMap.get(atk.defenderTag) || ({ name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 } as WarClanMember);
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
        const starsStr = DiscordService.formatStars(attack.stars);
        const isThreeStar = attack.stars === 3;
        const isClan = attack.isClanAttack;

        const embed: DiscordEmbed = {
          title: isClan ? `💥 War Attack: ${attack.attacker.name}` : `🛡️ Enemy Attack on: ${attack.defender.name}`,
          description: [
            `**#${attack.attacker.mapPosition} ${attack.attacker.name}** (TH${attack.attacker.townhallLevel}) attacked **#${attack.defender.mapPosition} ${attack.defender.name}** (TH${attack.defender.townhallLevel})`,
            '',
            `⭐ **Result**: ${starsStr} (${attack.destructionPercentage}%)`,
            `🏰 **Live Score**: ${currentWar.clan.stars} ${EMOJIS.STAR} vs ${currentWar.opponent.stars} ${EMOJIS.STAR}`,
            `💥 **Destruction**: ${currentWar.clan.destructionPercentage.toFixed(1)}% vs ${currentWar.opponent.destructionPercentage.toFixed(1)}%`,
          ].join('\n'),
          color: isClan ? (isThreeStar ? COLORS.GOLD : COLORS.GREEN) : (isThreeStar ? COLORS.RED : COLORS.BLUE),
          footer: { text: 'Bimgus • Clash of Clans Tracker' },
          timestamp: new Date().toISOString(),
        };

        await DiscordService.sendWebhook(webhookUrl, {
          embeds: [embed],
          components: [DiscordService.warActionRow(currentWar.clan.tag, currentWar.opponent.tag)],
        });
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

  const { postWarAudit } = buildWarEndSummaryMessages(currentWar);

  // 4. War Ended Announcement
  if (
    currentWar.state === 'warEnded' &&
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
    pingedMissedAttacks: prevSnapshot?.pingedMissedAttacks || false,
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

/**
 * Builds a clean War Matchup / Preparation embed with schedule and war format.
 */
function buildWarMatchupEmbed(currentWar: CurrentWarResponse): DiscordEmbed {
  const startUnix = currentWar.startTime
    ? Math.floor(new Date(formatCoCTime(currentWar.startTime)).getTime() / 1000)
    : null;
  const endUnix = currentWar.endTime
    ? Math.floor(new Date(formatCoCTime(currentWar.endTime)).getTime() / 1000)
    : null;

  const isPrep = currentWar.state === 'preparation';
  const stateLabel = isPrep ? '⏳ Preparation Day' : '🔥 Battle Day Active';

  const descLines: string[] = [
    `🎯 **Opponent Clan**: **${currentWar.opponent.name}** (${currentWar.opponent.tag}) • Lvl ${currentWar.opponent.clanLevel}`,
    `👥 **War Format**: **${currentWar.teamSize} vs ${currentWar.teamSize}** (2 attacks per member • ${currentWar.teamSize * 2} attacks total)`,
    `⏳ **Current State**: **${stateLabel}**`,
  ];

  if (isPrep && startUnix) {
    descLines.push(`⏰ **Battle Day Begins**: <t:${startUnix}:R> (<t:${startUnix}:f>)`);
  }
  if (endUnix) {
    descLines.push(`🏁 **War Concludes**: <t:${endUnix}:R> (<t:${endUnix}:f>)`);
  }

  const badgeUrl =
    currentWar.opponent.badgeUrls?.large ||
    currentWar.opponent.badgeUrls?.medium ||
    currentWar.opponent.badgeUrls?.small;

  return {
    title: isPrep
      ? `⚔️ War Preparation: ${currentWar.clan.name} vs ${currentWar.opponent.name}`
      : `🔥 War Battle Day: ${currentWar.clan.name} vs ${currentWar.opponent.name}`,
    description: descLines.join('\n'),
    color: isPrep ? COLORS.PURPLE : COLORS.GOLD,
    thumbnail: badgeUrl ? { url: badgeUrl } : undefined,
    footer: { text: `Clan War • ${currentWar.teamSize}v${currentWar.teamSize} • Bimgus Tracker` },
    timestamp: new Date().toISOString(),
  };
}

export interface WarEndSummaryResult {
  endEmbed: DiscordEmbed;
  auditEmbed: DiscordEmbed;
  auditLines: string[];
  postWarAudit: {
    zeroAttacks: Array<{ tag: string; name: string; mapPosition: number; townhallLevel: number }>;
    partialAttacks: Array<{ tag: string; name: string; mapPosition: number; townhallLevel: number; attacksUsed: number; starsGained: number }>;
    wastedAttacks: Array<{ attackerName: string; attackerPos: number; defenderName: string; defenderPos: number; stars: number; destruction: number }>;
    mvps: Array<{ name: string; mapPosition: number; townhallLevel: number; totalStars: number; avgDestruction: number }>;
  };
  won: boolean;
  tied: boolean;
}

export function buildWarEndSummaryMessages(currentWar: CurrentWarResponse): WarEndSummaryResult {
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
          defender: oppMap.get(atk.defenderTag) || { name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 },
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
          defender: clanMap.get(atk.defenderTag) || { name: 'Unknown', mapPosition: 0, tag: atk.defenderTag, townhallLevel: 0 },
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

  const clanAttacksSorted = allAttacks
    .filter((a) => a.isClanAttack)
    .sort((a, b) => a.order - b.order);

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
  const partialAttacks: Array<{ tag: string; name: string; mapPosition: number; townhallLevel: number; attacksUsed: number; starsGained: number }> = [];
  const mvps: Array<{ name: string; mapPosition: number; townhallLevel: number; totalStars: number; avgDestruction: number }> = [];

  for (const m of currentWar.clan.members) {
    const used = m.attacks ? m.attacks.length : 0;
    const starsGained = (m.attacks || []).reduce((acc, a) => acc + a.stars, 0);
    const totalDestruction = (m.attacks || []).reduce((acc, a) => acc + a.destructionPercentage, 0);

    if (used === 0) {
      zeroAttacks.push({ tag: m.tag, name: m.name, mapPosition: m.mapPosition, townhallLevel: m.townhallLevel });
    } else if (used < attacksPerMember) {
      partialAttacks.push({ tag: m.tag, name: m.name, mapPosition: m.mapPosition, townhallLevel: m.townhallLevel, attacksUsed: used, starsGained });
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

  const outcomeTitle = won ? '🏆 WAR VICTORY!' : tied ? '🤝 WAR TIED!' : '💀 WAR DEFEAT';
  const outcomeColor = won ? COLORS.GOLD : tied ? COLORS.BLUE : COLORS.RED;

  const endEmbed: DiscordEmbed = {
    title: outcomeTitle,
    description: [
      `The war against **${currentWar.opponent.name}** has officially ended!`,
      '',
      `🏰 **${currentWar.clan.name}**:`,
      `${EMOJIS.STAR} **Stars**: ${currentWar.clan.stars}`,
      `💥 **Destruction**: ${currentWar.clan.destructionPercentage.toFixed(2)}%`,
      `🗡️ **Attacks Used**: ${currentWar.clan.attacks}`,
      '',
      `⚔️ **${currentWar.opponent.name}**:`,
      `${EMOJIS.STAR} **Stars**: ${currentWar.opponent.stars}`,
      `💥 **Destruction**: ${currentWar.opponent.destructionPercentage.toFixed(2)}%`,
      `🗡️ **Attacks Used**: ${currentWar.opponent.attacks}`,
    ].join('\n'),
    color: outcomeColor,
    footer: { text: 'Bimgus • Clash of Clans Tracker' },
    timestamp: new Date().toISOString(),
  };

  const auditLines: string[] = [];

  if (zeroAttacks.length > 0) {
    auditLines.push(`🚨 **Missed All Attacks (0/${attacksPerMember})**:`);
    zeroAttacks.sort((a, b) => a.mapPosition - b.mapPosition).forEach((m) => {
      auditLines.push(`• **#${m.mapPosition} ${m.name}** (TH${m.townhallLevel}) — 0 attacks`);
    });
    auditLines.push('');
  } else {
    auditLines.push('✅ **100% Clan Participation**: Every member hit at least once!');
    auditLines.push('');
  }

  if (partialAttacks.length > 0) {
    auditLines.push(`⚠️ **Partial Attacks (1/${attacksPerMember})**:`);
    partialAttacks.sort((a, b) => a.mapPosition - b.mapPosition).forEach((m) => {
      auditLines.push(`• **#${m.mapPosition} ${m.name}** (TH${m.townhallLevel}) — 1 hit (${m.starsGained} ${EMOJIS.STAR})`);
    });
    auditLines.push('');
  }

  if (wastedAttacks.length > 0) {
    auditLines.push(`🎯 **Attacked Bases Already 3-Starred (0 Net Stars)**:`);
    wastedAttacks.forEach((w) => {
      auditLines.push(`• **#${w.attackerPos} ${w.attackerName}** attacked **#${w.defenderPos} ${w.defenderName}** (was already 3 ${EMOJIS.STAR})`);
    });
    auditLines.push('');
  } else {
    auditLines.push('🎯 **Smart Targeting**: No attacks were wasted on already 3-starred bases!');
    auditLines.push('');
  }

  if (mvps.length > 0) {
    auditLines.push(`${EMOJIS.STAR} **War MVPs (Max ${attacksPerMember * 3} ${EMOJIS.STAR} Hitters)**:`);
    mvps.forEach((mvp) => {
      auditLines.push(`• **#${mvp.mapPosition} ${mvp.name}** (TH${mvp.townhallLevel}) — ${mvp.totalStars} ${EMOJIS.STAR} (${mvp.avgDestruction.toFixed(0)}% avg)`);
    });
  }

  const auditEmbed: DiscordEmbed = {
    title: '📋 Post-War Performance & Attack Audit',
    description: auditLines.join('\n'),
    color: COLORS.PURPLE,
    footer: { text: 'Bimgus • Clash of Clans Tracker' },
    timestamp: new Date().toISOString(),
  };

  return {
    endEmbed,
    auditEmbed,
    auditLines,
    postWarAudit,
    won,
    tied,
  };
}

export async function sendWarSummaryDiscord(
  webhookUrl: string,
  currentWar: CurrentWarResponse
): Promise<boolean> {
  const { endEmbed, auditEmbed } = buildWarEndSummaryMessages(currentWar);

  // 1. Send War Recap Embed
  await DiscordService.sendWebhook(webhookUrl, {
    embeds: [endEmbed],
    components: [DiscordService.warActionRow(currentWar.clan.tag, currentWar.opponent.tag)],
  });

  // 2. Build and Send Post-War Audit Embed
  await DiscordService.sendWebhook(webhookUrl, {
    embeds: [auditEmbed],
    components: [DiscordService.warActionRow(currentWar.clan.tag)],
  });

  return true;
}

