import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService, COLORS } from '../services/discordService';
import { PlayerTrackingService } from '../services/playerTrackingService';
import { CocAssetService } from '../services/cocAssetService';
import { config } from '../config';
import { mapWithConcurrency } from '../utils/concurrency';
import { changedIgnoringUpdatedAt } from '../utils/changes';
import { discordTime } from '../utils/discordTime';
import { getWarId } from '../diff/warDiff';
import { InProgressUpgrade, VillageImportService } from '../services/villageImportService';
import {
  UpgradeEvent,
  eventFromTimer,
  finishedHeroTimer,
  isDmPaused,
  notifyUpgrades,
} from '../services/upgradeNotifier';
import { dmToggleButton } from '../api/discord/components/dmToggle';
import { log } from '../utils/log';
import { card, layoutMessage } from '../services/discordLayout';
import { DiscordWebhookPayload } from '../types/discord';
import { LinkedAccount } from '../types/user';

const USER_CONCURRENCY = 3;
const SNAPSHOT_REFRESH_MS = 10 * 60 * 1000;

/** The DM to each account in a newly declared war: where it is on the map and when battle day starts. */
export function buildRosterDm(
  account: LinkedAccount,
  warMember: { mapPosition: number; townhallLevel: number },
  opponentName: string,
  teamSize: number,
  warStartTimeMs: number
): DiscordWebhookPayload {
  return layoutMessage(
    card({
      accent: COLORS.GOLD,
      title: `⚔️ [${account.name}] You're in the war vs ${opponentName}`,
      body: [
        `#${warMember.mapPosition} on the map · TH${warMember.townhallLevel} · ${teamSize}v${teamSize}`,
        `Battle day ${discordTime(warStartTimeMs)}`,
      ].join('\n'),
      thumbnail: CocAssetService.getTownHallUrl(warMember.townhallLevel),
      footer: `Account: ${account.name} (${account.playerTag})`,
      buttons: [dmToggleButton(account.playerTag)],
    })
  );
}

export async function runPlayerTrackingJob(): Promise<{ success: boolean; checkedAccounts: number; dmsSent: number }> {
  const users = await FirestoreService.getAllUsers();
  if (!users || users.length === 0) {
    return { success: true, checkedAccounts: 0, dmsSent: 0 };
  }

  const cocService = CocService.shared();
  let checkedAccounts = 0;
  let dmsSent = 0;

  // A few users at a time (3.2): each user's accounts and save stay in order
  await mapWithConcurrency(users, USER_CONCURRENCY, async (user) => {
    let userModified = false;

    for (let i = 0; i < user.accounts.length; i++) {
      const account = user.accounts[i];
      checkedAccounts++;
      const events: UpgradeEvent[] = [];
      const village = VillageImportService.read(account.villageData);

      try {
        const freshPlayer = await cocService.getPlayer(account.playerTag);
        account.townHallLevel = freshPlayer.townHallLevel;
        account.builderHallLevel = freshPlayer.builderHallLevel;
        account.name = freshPlayer.name;

        events.push(...PlayerTrackingService.detectApiUpgrades(account.lastSnapshot, freshPlayer));

        // Keep the stored snapshot fresh for /heroes, /sixth-builder, /status and /roast, but only
        // write it when it changed or is getting old (/roast treats one over 15 minutes old as stale)
        const nextSnapshot = PlayerTrackingService.createSnapshot(freshPlayer);
        const prevAge = account.lastSnapshot
          ? Date.now() - new Date(account.lastSnapshot.updatedAt).getTime()
          : Infinity;
        if (changedIgnoringUpdatedAt(account.lastSnapshot, nextSnapshot) || prevAge >= SNAPSHOT_REFRESH_MS) {
          account.lastSnapshot = nextSnapshot;
          userModified = true;
        }
      } catch (playerErr: any) {
        log.warn(`[PlayerTracking] Failed to poll live player ${account.playerTag}: ${playerErr.message}`);
      }

      // Timers from the imported export: move the stored level up, and DM for what the API can't see.
      // A hero timer the API has reached is finished too, and the API's level-up has said so.
      if (village) {
        const now = Date.now();
        const reached = (up: InProgressUpgrade) => finishedHeroTimer(up, account.lastSnapshot);
        const done = (up: InProgressUpgrade) => up.finishesAtMs <= now || reached(up);
        const due = village.inProgressUpgrades.filter(done);
        if (due.length > 0) {
          village.inProgressUpgrades = village.inProgressUpgrades.filter((up) => !done(up));
          for (const up of due) {
            VillageImportService.applyCompletedTimer(village, up);
            const event = reached(up) ? null : eventFromTimer(up);
            if (event) events.push(event);
          }
          account.villageData = village;
          userModified = true;
        }
      }

      if (events.length > 0) {
        dmsSent += await notifyUpgrades(user, account, events);
        userModified = true;
      }
    }

    if (userModified) {
      await FirestoreService.saveUser(user);
    }
  });

  // 4. Check for War Preparation Roster Announcements
  try {
    const clanTag = config.coc.clanTag;
    if (clanTag) {
      const warData = await cocService.getCurrentWar(clanTag);
      if (warData.state === 'preparation' && warData.preparationStartTime) {
        const warSnap = await FirestoreService.getWarSnapshot(clanTag);
        const warId = getWarId(warData);

        // Only once the war task has saved this war: writing the new war id onto the previous war's
        // snapshot would carry over its logged attacks and matchup flag, so this war's posts never went out
        if (warSnap?.warId === warId && !warSnap.rosterNotified) {
          const ourClan =
            warData.clan.tag.toUpperCase() === config.formatTag(clanTag).toUpperCase()
              ? warData.clan
              : warData.opponent;
          const opponent =
            warData.clan.tag.toUpperCase() === config.formatTag(clanTag).toUpperCase()
              ? warData.opponent
              : warData.clan;

          const warStartTimeMs = warData.startTime
            ? new Date(
                warData.startTime.replace(
                  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/,
                  '$1-$2-$3T$4:$5:$6.$7Z'
                )
              ).getTime()
            : Date.now() + 24 * 3600 * 1000;

          for (const user of users) {
            if (isDmPaused(user)) continue;
            for (const account of user.accounts) {
              if (account.dmsEnabled === false) continue;
              const warMember = ourClan.members.find((m) => m.tag.toUpperCase() === account.playerTag.toUpperCase());

              if (warMember) {
                await DiscordService.sendDm(
                  user.discordUserId,
                  buildRosterDm(account, warMember, opponent.name, warData.teamSize, warStartTimeMs)
                );
                dmsSent++;
              }
            }
          }

          await FirestoreService.saveWarSnapshot(clanTag, { ...warSnap, rosterNotified: true });
        }
      }
    }
  } catch (warRosterErr: any) {
    log.warn(`[PlayerTracking] War roster check skipped: ${warRosterErr.message}`);
  }

  return { success: true, checkedAccounts, dmsSent };
}
