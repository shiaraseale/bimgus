import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService, COLORS } from '../services/discordService';
import { PlayerTrackingService } from '../services/playerTrackingService';
import { CocAssetService } from '../services/cocAssetService';
import { config } from '../config';
import { getWarId } from '../diff/warDiff';
import { InProgressUpgrade, VillageImportService } from '../services/villageImportService';
import {
  UpgradeEvent,
  eventFromTimer,
  heroUpgradeStarts,
  isDmPaused,
  notifyUpgrades,
  withoutImportedTimers,
} from '../services/upgradeNotifier';

export async function runPlayerTrackingJob(): Promise<{ success: boolean; checkedAccounts: number; dmsSent: number }> {
  const users = await FirestoreService.getAllUsers();
  if (!users || users.length === 0) {
    return { success: true, checkedAccounts: 0, dmsSent: 0 };
  }

  const cocService = CocService.shared();
  let checkedAccounts = 0;
  let dmsSent = 0;

  for (const user of users) {
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
        const detected = heroUpgradeStarts(PlayerTrackingService.detectApiUpgrades(account.lastSnapshot, freshPlayer), village);
        events.push(...detected.events);
        if (detected.pending.length > 0) {
          account.pendingUpgrades = [...(account.pendingUpgrades ?? []), ...detected.pending];
        }

        // Keep stored snapshot fresh for /heroes, /sixth-builder, /upgrades and /roast
        account.lastSnapshot = PlayerTrackingService.createSnapshot(freshPlayer);
        userModified = true;
      } catch (playerErr: any) {
        console.warn(`[PlayerTracking] Failed to poll live player ${account.playerTag}: ${playerErr.message}`);
      }

      // Hero timers started from the API: DM when they should be done (unless an import now covers them)
      if (account.pendingUpgrades?.length) {
        const now = Date.now();
        const pending = withoutImportedTimers(account.pendingUpgrades, village);
        for (const up of pending.filter((p) => p.finishesAtMs <= now)) {
          const event = eventFromTimer(up as InProgressUpgrade);
          if (event) events.push(event);
        }
        account.pendingUpgrades = pending.filter((p) => p.finishesAtMs > now);
        userModified = true;
      }

      // Timers from the imported export: move the stored level up, and DM for what the API can't see
      if (village) {
        const now = Date.now();
        const due = village.inProgressUpgrades.filter((up) => up.finishesAtMs <= now);
        if (due.length > 0) {
          village.inProgressUpgrades = village.inProgressUpgrades.filter((up) => up.finishesAtMs > now);
          for (const up of due) {
            VillageImportService.applyCompletedTimer(village, up);
            const event = eventFromTimer(up);
            if (event) events.push(event);
          }
          account.villageData = village;
          userModified = true;
        }
      }

      // Manually logged upgrades (legacy; nothing creates new ones)
      if (Array.isArray(account.activeUpgrades)) {
        for (const au of account.activeUpgrades) {
          if (!au.completed && new Date(au.finishesAt).getTime() <= Date.now()) {
            au.completed = true;
            userModified = true;
            events.push({
              kind: 'expected', name: au.name, assetName: au.name, category: au.category, village: au.village,
              oldLevel: au.targetLevel - 1, newLevel: au.targetLevel, maxLevel: au.maxLevelForTh || au.targetLevel,
              count: 1, key: `manual:${au.id}`,
            });
          }
        }
      }

      if (events.length > 0) {
        dmsSent += await notifyUpgrades(user, account, events);
        userModified = true;
      }

      // Check Builder's Apprentice timer
      if (
        account.apprenticeTimer &&
        !account.apprenticeTimer.notified &&
        new Date(account.apprenticeTimer.readyAt).getTime() <= Date.now()
      ) {
        account.apprenticeTimer.notified = true;
        userModified = true;

        if (account.dmsEnabled !== false) {
          await DiscordService.sendDm(user.discordUserId, {
            embeds: [
              {
                title: `🛠️ [${account.name}] Builder's Apprentice Ready!`,
                description: `Your **Builder's Apprentice** is rested and ready for a new assignment!`,
                color: COLORS.GOLD,
                thumbnail: { url: CocAssetService.getApprenticeUrl('builder') },
                footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus` },
                timestamp: new Date().toISOString(),
              },
            ],
            components: [
              DiscordService.createActionRow([DiscordService.openGameLinkButton()]),
            ],
          });
          dmsSent++;
        }
      }
    }

    if (userModified) {
      await FirestoreService.saveUser(user);
    }
  }

  // 4. Check for War Preparation Roster Announcements
  try {
    const clanTag = config.coc.clanTag;
    if (clanTag) {
      const warData = await cocService.getCurrentWar(clanTag);
      if (warData.state === 'preparation' && warData.preparationStartTime) {
        const warSnap = await FirestoreService.getWarSnapshot(clanTag);
        const warId = getWarId(warData);

        // If we haven't already notified users about this war's roster
        if (!warSnap?.rosterNotified || warSnap.warId !== warId) {
          const ourClan = warData.clan.tag.toUpperCase() === config.formatTag(clanTag).toUpperCase()
            ? warData.clan
            : warData.opponent;
          const opponent = warData.clan.tag.toUpperCase() === config.formatTag(clanTag).toUpperCase()
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
              const warMember = ourClan.members.find(
                (m) => m.tag.toUpperCase() === account.playerTag.toUpperCase()
              );

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
                });
                dmsSent++;
              }
            }
          }

          if (warSnap) {
            await FirestoreService.saveWarSnapshot(clanTag, {
              ...warSnap,
              warId,
              rosterNotified: true,
            });
          }
        }
      }
    }
  } catch (warRosterErr: any) {
    console.warn(`[PlayerTracking] War roster check skipped: ${warRosterErr.message}`);
  }

  return { success: true, checkedAccounts, dmsSent };
}
