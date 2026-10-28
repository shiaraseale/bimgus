import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService, COLORS } from '../services/discordService';
import { PlayerTrackingService } from '../services/playerTrackingService';
import { CocAssetService } from '../services/cocAssetService';
import { config } from '../config';
import { mapWithConcurrency } from '../utils/concurrency';
import { changedIgnoringUpdatedAt } from '../utils/changes';
import { getWarId } from '../diff/warDiff';
import { InProgressUpgrade, VillageImportService } from '../services/villageImportService';
import {
  UpgradeEvent,
  eventFromTimer,
  heroUpgradeStarts,
  isDmPaused,
  notifyUpgrades,
  supersededHeroTimer,
  withoutImportedTimers,
} from '../services/upgradeNotifier';
import { dmToggleButton } from '../api/discord/components/dmToggle';
import { log } from '../utils/log';

const USER_CONCURRENCY = 3;
const SNAPSHOT_REFRESH_MS = 10 * 60 * 1000;

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

        // Hero level-ups in the API are upgrade starts; they become timers rather than DMs
        const detected = heroUpgradeStarts(
          PlayerTrackingService.detectApiUpgrades(account.lastSnapshot, freshPlayer),
          village
        );
        events.push(...detected.events);
        if (detected.pending.length > 0) {
          account.pendingUpgrades = [...(account.pendingUpgrades ?? []), ...detected.pending];
          userModified = true;
        }

        // Keep the stored snapshot fresh for /heroes, /sixth-builder, /upgrades and /roast, but only
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

      // Hero timers started from the API: DM when they should be done (unless an import now covers them)
      if (account.pendingUpgrades?.length) {
        const now = Date.now();
        const pending = withoutImportedTimers(account.pendingUpgrades, village).filter(
          (p) => !supersededHeroTimer(p, account.lastSnapshot)
        );
        for (const up of pending.filter((p) => p.finishesAtMs <= now)) {
          const event = eventFromTimer(up as InProgressUpgrade);
          if (event) events.push(event);
        }
        const stillPending = pending.filter((p) => p.finishesAtMs > now);
        if (stillPending.length !== account.pendingUpgrades.length) {
          account.pendingUpgrades = stillPending;
          userModified = true;
        }
      }

      // Timers from the imported export: move the stored level up, and DM for what the API can't see.
      // A hero timer the API has moved past is finished too, but too late to DM about.
      if (village) {
        const now = Date.now();
        const superseded = (up: InProgressUpgrade) => supersededHeroTimer(up, account.lastSnapshot);
        const done = (up: InProgressUpgrade) => up.finishesAtMs <= now || superseded(up);
        const due = village.inProgressUpgrades.filter(done);
        if (due.length > 0) {
          village.inProgressUpgrades = village.inProgressUpgrades.filter((up) => !done(up));
          for (const up of due) {
            VillageImportService.applyCompletedTimer(village, up);
            const event = superseded(up) ? null : eventFromTimer(up);
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
                await DiscordService.sendDm(user.discordUserId, {
                  embeds: [
                    {
                      title: `⚔️ [${account.name}] You're In! War Declared!`,
                      description: [
                        `A new war has been declared against **${opponent.name}**!`,
                        '',
                        `📍 **Map Position**: #${warMember.mapPosition}`,
                        `🏰 **Town Hall**: TH${warMember.townhallLevel}`,
                        `👥 **Team Size**: ${warData.teamSize}v${warData.teamSize}`,
                        `⏳ **Battle Day Starts**: <t:${Math.floor(warStartTimeMs / 1000)}:R>`,
                        '',
                        `Make sure to set your war base layout and prepare your army!`,
                      ].join('\n'),
                      color: COLORS.GOLD,
                      thumbnail: {
                        url: CocAssetService.getTownHallUrl(warMember.townhallLevel),
                      },
                      footer: { text: `War vs ${opponent.name} • Bimgus Tracker` },
                      timestamp: new Date().toISOString(),
                    },
                  ],
                  components: [DiscordService.createActionRow([dmToggleButton(account.playerTag)])],
                });
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
