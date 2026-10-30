import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService, COLORS } from '../services/discordService';
import { card, layoutMessage } from '../services/discordLayout';
import { config } from '../config';
import { CurrentWarResponse, WarClan } from '../types/coc';
import { DiscordWebhookPayload } from '../types/discord';
import { findActiveCwlWar } from '../diff/cwlWars';
import { getWarId, scoreLine } from '../diff/warDiff';
import { isExpectedApiMiss, log } from '../utils/log';
import { discordTime } from '../utils/discordTime';

export interface ReminderInput {
  ourClan: WarClan;
  enemyClan: WarClan;
  teamSize: number;
  attacksPerMember: number;
  hoursLeft: number;
  endMs: number;
  clanTag: string;
  roundNum?: number; // a CWL round
}

// Whole hours, rounded down as Discord's "in 3 hours" is, so the title and the end time agree
const timeLeft = (hours: number) => (hours < 1 ? 'Under an hour' : `~${Math.floor(hours)}h`);

/** Who still has attacks to make, with the time left and the score; null when everyone has attacked. */
export function buildAttackReminder(r: ReminderInput): DiscordWebhookPayload | null {
  const waiting = r.ourClan.members
    .filter((m) => (m.attacks?.length ?? 0) < r.attacksPerMember)
    .sort((a, b) => a.mapPosition - b.mapPosition);
  if (waiting.length === 0) return null;

  // "(1 left)" only for someone who has attacked but not used them all
  const names = waiting.map((m) => {
    const used = m.attacks?.length ?? 0;
    return `#${m.mapPosition} ${m.name}${used > 0 ? ` (${r.attacksPerMember - used} left)` : ''}`;
  });
  return layoutMessage(
    card({
      accent: COLORS.RED,
      title: `⚠️ ${timeLeft(r.hoursLeft)} left in ${r.roundNum ? `CWL round ${r.roundNum}` : 'the war'} vs ${r.enemyClan.name}`,
      body: [`**Still to attack**: ${names.join(', ')}`, `Ends ${discordTime(r.endMs)}`].join('\n'),
      footer: `Score ${scoreLine(r.ourClan, r.enemyClan)} · ${r.ourClan.attacks}/${r.teamSize * r.attacksPerMember} attacks`,
      buttons: DiscordService.warActionRow(r.clanTag).components,
    })
  );
}

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
    } catch (err: any) {
      // A private war log (403) is expected; anything else is worth knowing about
      if (!isExpectedApiMiss(err)) log.warn(`[WarPing] Could not fetch the current war: ${err.message}`);
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
      } catch (err: any) {
        if (!isExpectedApiMiss(err)) log.warn(`[WarPing] Could not check CWL: ${err.message}`);
      }
    }

    if (!activeWar || !activeWar.endTime) {
      return { success: true, message: 'Not currently in battle day (neither regular nor CWL)' };
    }

    const warEndTimeMs = new Date(
      activeWar.endTime.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/, '$1-$2-$3T$4:$5:$6.$7Z')
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

        const reminder = buildAttackReminder({
          ourClan,
          enemyClan,
          teamSize: activeWar.teamSize,
          attacksPerMember: 1, // Exactly 1 hit in CWL
          hoursLeft: hoursRemaining,
          endMs: warEndTimeMs,
          clanTag: targetTag,
          roundNum: cwlRoundIndex + 1,
        });

        if (reminder) {
          await DiscordService.sendWebhook(webhookUrl, reminder);

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
        // The war task saves each war's snapshot first; another war's flag doesn't apply to this one
        if (warSnap?.warId !== getWarId(activeWar)) {
          return { success: true, message: "This war's snapshot isn't saved yet; checking again next time" };
        }
        if (warSnap.pingedMissedAttacks) {
          return { success: true, message: 'Missed attacks reminder already sent for this war' };
        }

        const reminder = buildAttackReminder({
          ourClan,
          enemyClan,
          teamSize: activeWar.teamSize,
          attacksPerMember: activeWar.attacksPerMember || 2,
          hoursLeft: hoursRemaining,
          endMs: warEndTimeMs,
          clanTag: targetTag,
        });

        if (reminder) {
          await DiscordService.sendWebhook(botConfig.webhooks.warRoom || webhookUrl, reminder);

          await FirestoreService.saveWarSnapshot(targetTag, { ...warSnap, pingedMissedAttacks: true });
        }
      }
    }

    return { success: true, message: 'War reminder check completed' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}
