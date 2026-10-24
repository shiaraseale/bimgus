import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService, COLORS } from '../services/discordService';
import { config } from '../config';
import { CurrentWarResponse } from '../types/coc';
import { findActiveCwlWar } from '../diff/cwlWars';

export async function runWarPingJob(clanTagOverride?: string): Promise<{ success: boolean; message: string }> {
  const targetTag = clanTagOverride || config.coc.clanTag;
  if (!targetTag) return { success: false, message: 'No clan tag configured' };

  const cocService = CocService.shared();
  const botConfig = await FirestoreService.getConfig(targetTag);

  const webhookUrl = botConfig.webhooks.cwlHub || botConfig.webhooks.warRoom;
  if (!botConfig.notificationsEnabled.warAttackReminders || !webhookUrl) {
    return { success: true, message: 'War attack reminders disabled or webhook missing' };
  }

  try {
    let activeWar: CurrentWarResponse | null = null;
    let isCwlWar = false;
    let cwlRoundIndex = 0;

    // 1. Check Standard War
    try {
      const war = await cocService.getCurrentWar(targetTag);
      if (war.state === 'inWar' && war.endTime) {
        activeWar = war;
      }
    } catch {
      // Standard war not accessible
    }

    // 2. Check CWL War if not in standard battle day
    if (!activeWar) {
      try {
        const cwlGroup = await cocService.getCwlGroup(targetTag);
        if (cwlGroup && cwlGroup.state !== 'notInWar' && cwlGroup.rounds) {
          const active = await findActiveCwlWar(cwlGroup, targetTag, cocService, ['inWar']);
          if (active && active.war.endTime) {
            activeWar = active.war;
            isCwlWar = true;
            cwlRoundIndex = active.roundIndex;
          }
        }
      } catch {
        // Not in CWL
      }
    }

    if (!activeWar || !activeWar.endTime) {
      return { success: true, message: 'Not currently in battle day (neither regular nor CWL)' };
    }

    const warEndTimeMs = new Date(
      activeWar.endTime.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/,
        '$1-$2-$3T$4:$5:$6.$7Z'
      )
    ).getTime();
    const nowMs = Date.now();
    const hoursRemaining = (warEndTimeMs - nowMs) / (1000 * 60 * 60);

    // If less than 4 hours remaining (and greater than 0)
    if (hoursRemaining > 0 && hoursRemaining <= 4) {
      const isHomeClan = activeWar.clan.tag.toUpperCase() === targetTag.toUpperCase();
      const ourClan = isHomeClan ? activeWar.clan : activeWar.opponent;
      const enemyClan = isHomeClan ? activeWar.opponent : activeWar.clan;

      if (isCwlWar) {
        const cwlSnap = await FirestoreService.getCwlSnapshot(targetTag);
        const pingedRounds = new Set<number>(cwlSnap?.pingedMissedAttacksRounds || []);
        if (pingedRounds.has(cwlRoundIndex)) {
          return { success: true, message: `CWL reminder already sent for round ${cwlRoundIndex + 1}` };
        }

        const attacksPerMember = 1; // Exactly 1 hit in CWL
        const membersWithUnusedAttacks = ourClan.members
          .filter((m) => !m.attacks || m.attacks.length < attacksPerMember)
          .map((m) => `• **#${m.mapPosition} ${m.name}** (TH${m.townhallLevel}) — ${m.attacks?.length || 0}/${attacksPerMember} attacks used`);

        if (membersWithUnusedAttacks.length > 0) {
          const roundNum = cwlRoundIndex + 1;
          await DiscordService.sendWebhook(webhookUrl, {
            content: '⚠️ **CWL Alert: Attacks Needed Before Round Ends!**',
            embeds: [
              {
                title: `⏳ Only ~${Math.round(hoursRemaining)}h Left in CWL Round ${roundNum}!`,
                description: [
                  `War vs **${enemyClan.name}** ends <t:${Math.floor(warEndTimeMs / 1000)}:R>!`,
                  '',
                  `The following members still need to make their 1 attack:`,
                  membersWithUnusedAttacks.join('\n'),
                  '',
                  `🏰 **Current Score**: ${ourClan.stars} ⭐ vs ${enemyClan.stars} ⭐`,
                  `💥 **Destruction**: ${ourClan.destructionPercentage.toFixed(1)}% vs ${enemyClan.destructionPercentage.toFixed(1)}%`,
                  `🗡️ **Clan Attacks**: ${ourClan.attacks}/${activeWar.teamSize}`,
                ].join('\n'),
                color: COLORS.RED,
                footer: { text: `CWL Round ${roundNum} • Bimgus Tracker` },
                timestamp: new Date().toISOString(),
              },
            ],
            components: [DiscordService.warReminderActionRow(targetTag)],
          });

          pingedRounds.add(cwlRoundIndex);
          if (cwlSnap) {
            await FirestoreService.saveCwlSnapshot(targetTag, {
              ...cwlSnap,
              pingedMissedAttacksRounds: Array.from(pingedRounds),
            });
          }
        }
      } else {
        // Standard War
        const warSnap = await FirestoreService.getWarSnapshot(targetTag);
        if (warSnap?.pingedMissedAttacks) {
          return { success: true, message: 'Missed attacks reminder already sent for this war' };
        }

        const attacksPerMember = activeWar.attacksPerMember || 2;
        const membersWithUnusedAttacks = ourClan.members
          .filter((m) => (!m.attacks ? attacksPerMember : attacksPerMember - m.attacks.length) > 0)
          .map((m) => {
            const used = m.attacks ? m.attacks.length : 0;
            return `• **${m.name}** (used ${used}/${attacksPerMember})`;
          });

        if (membersWithUnusedAttacks.length > 0) {
          await DiscordService.sendWebhook(botConfig.webhooks.warRoom || webhookUrl, {
            content: '⚠️ **War Alert: Remaining Attacks Warning!**',
            embeds: [
              {
                title: `⏳ Only ~${Math.round(hoursRemaining)} Hours Left in War!`,
                description: [
                  `The following members still have attacks remaining:`,
                  '',
                  membersWithUnusedAttacks.join('\n'),
                  '',
                  `🏰 **Current Score**: ${ourClan.stars} ⭐ vs ${enemyClan.stars} ⭐`,
                  `💥 **Clan Destruction**: ${ourClan.destructionPercentage.toFixed(1)}%`,
                ].join('\n'),
                color: COLORS.RED,
                footer: { text: 'Bimgus • Clash of Clans Tracker' },
                timestamp: new Date().toISOString(),
              },
            ],
            components: [DiscordService.warReminderActionRow(targetTag)],
          });

          if (warSnap) {
            await FirestoreService.saveWarSnapshot(targetTag, {
              ...warSnap,
              pingedMissedAttacks: true,
            });
          }
        }
      }
    }

    return { success: true, message: 'War reminder check completed' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}
