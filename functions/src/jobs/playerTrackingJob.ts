import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { DiscordService, COLORS } from '../services/discordService';
import { PlayerTrackingService } from '../services/playerTrackingService';
import { CocAssetService } from '../services/cocAssetService';
import { config } from '../config';
import { getWarId } from '../diff/warDiff';
import { InProgressUpgrade, ParsedDefenseGroup } from '../services/villageImportService';

export async function runPlayerTrackingJob(): Promise<{ success: boolean; checkedAccounts: number; dmsSent: number }> {
  const users = await FirestoreService.getAllUsers();
  if (!users || users.length === 0) {
    return { success: true, checkedAccounts: 0, dmsSent: 0 };
  }

  const cocService = new CocService();
  let checkedAccounts = 0;
  let dmsSent = 0;

  for (const user of users) {
    let userModified = false;

    for (let i = 0; i < user.accounts.length; i++) {
      const account = user.accounts[i];
      checkedAccounts++;

      let freshPlayer: any = null;
      try {
        freshPlayer = await cocService.getPlayer(account.playerTag);
        account.townHallLevel = freshPlayer.townHallLevel;
        account.builderHallLevel = freshPlayer.builderHallLevel;
        account.name = freshPlayer.name;

        // Check for completed upgrades if previous snapshot exists
        if (account.lastSnapshot) {
          const completedUpgrades = PlayerTrackingService.detectCompletedUpgrades(
            account.lastSnapshot,
            freshPlayer
          );

          if (completedUpgrades.length > 0 && account.dmsEnabled !== false) {
            for (const upgrade of completedUpgrades) {
              const hallLevel = upgrade.village === 'builder'
                ? (freshPlayer.builderHallLevel || 10)
                : freshPlayer.townHallLevel;
              const hallTag = upgrade.village === 'builder' ? `BH${hallLevel}` : `TH${hallLevel}`;

              const embed = {
                title: `🎉 [${account.name}] Upgrade Completed!`,
                description: [
                  `Your **${upgrade.name}** has reached **Level ${upgrade.newLevel}**!`,
                  '',
                  `📊 **Level ${upgrade.newLevel}/${upgrade.maxLevel}** for ${hallTag}`,
                ].join('\n'),
                color: COLORS.GOLD,
                thumbnail: {
                  url: CocAssetService.getThumbnail(
                    upgrade.name,
                    upgrade.category,
                    upgrade.newLevel,
                    upgrade.village
                  ),
                },
                footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus` },
                timestamp: new Date().toISOString(),
              };

              await DiscordService.sendDm(user.discordUserId, {
                embeds: [embed],
                components: [
                  DiscordService.createActionRow([DiscordService.openGameLinkButton()]),
                ],
              });
              dmsSent++;
            }
          }
        }

        // Keep stored snapshot fresh for /heroes, /sixth-builder, and /upgrades
        account.lastSnapshot = PlayerTrackingService.createSnapshot(freshPlayer);
        userModified = true;
      } catch (playerErr: any) {
        console.warn(`[PlayerTracking] Failed to poll live player ${account.playerTag}: ${playerErr.message}`);
      }

      // Check timer-based in-progress upgrades from imported village JSON
      if (account.villageData && Array.isArray(account.villageData.inProgressUpgrades)) {
        const remainingUpgrades: InProgressUpgrade[] = [];
        const completedFromTimers: InProgressUpgrade[] = [];

        for (const up of account.villageData.inProgressUpgrades as InProgressUpgrade[]) {
          if (up.finishesAtMs && up.finishesAtMs <= Date.now()) {
            completedFromTimers.push(up);
          } else {
            remainingUpgrades.push(up);
          }
        }

        if (completedFromTimers.length > 0) {
          account.villageData.inProgressUpgrades = remainingUpgrades;
          userModified = true;

          for (const up of completedFromTimers) {
            // Update stored defense/building levels in villageData
            const listKey = up.village === 'builder'
              ? 'builderDefenses'
              : (up.category === 'building' ? 'homeBuildings' : 'homeDefenses');

            const list: ParsedDefenseGroup[] = account.villageData[listKey];
            if (Array.isArray(list)) {
              const oldEntry = list.find((d) => d.name === up.name && d.currentLevel === up.currentLevel);
              if (oldEntry) {
                if (oldEntry.count > 1) {
                  oldEntry.count -= 1;
                } else {
                  const idx = list.indexOf(oldEntry);
                  if (idx >= 0) list.splice(idx, 1);
                }
              }

              const newEntry = list.find((d) => d.name === up.name && d.currentLevel === up.targetLevel);
              if (newEntry) {
                newEntry.count += 1;
              } else {
                list.push({
                  name: up.name,
                  count: 1,
                  currentLevel: up.targetLevel,
                  maxLevel: up.maxLevel,
                  nextCostNumber: 0,
                  resource: '',
                  isMaxed: up.targetLevel >= up.maxLevel,
                  base: up.village,
                });
              }
            }

            // Send Upgrade Completed DM if DMs enabled
            if (account.dmsEnabled !== false) {
              const hallLevel = up.village === 'builder'
                ? (freshPlayer?.builderHallLevel || account.builderHallLevel || 10)
                : (freshPlayer?.townHallLevel || account.townHallLevel || 12);
              const hallTag = up.village === 'builder' ? `BH${hallLevel}` : `TH${hallLevel}`;

              const embed = {
                title: `🎉 [${account.name}] Upgrade Completed!`,
                description: [
                  `Your **${up.name}** has reached **Level ${up.targetLevel}**!`,
                  '',
                  `📊 **Level ${up.targetLevel}/${up.maxLevel}** for ${hallTag}`,
                ].join('\n'),
                color: COLORS.GOLD,
                thumbnail: {
                  url: CocAssetService.getThumbnail(
                    up.name,
                    up.category,
                    up.targetLevel,
                    up.village
                  ),
                },
                footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus` },
                timestamp: new Date().toISOString(),
              };

              await DiscordService.sendDm(user.discordUserId, {
                embeds: [embed],
                components: [
                  DiscordService.createActionRow([DiscordService.openGameLinkButton()]),
                ],
              });
              dmsSent++;
            }
          }
        }
      }

      // Check activeUpgrades timers
      if (Array.isArray(account.activeUpgrades)) {
        for (const au of account.activeUpgrades) {
          if (!au.completed && new Date(au.finishesAt).getTime() <= Date.now()) {
            au.completed = true;
            userModified = true;

            if (account.dmsEnabled !== false) {
              const hallLevel = au.village === 'builder'
                ? (freshPlayer?.builderHallLevel || account.builderHallLevel || 10)
                : (freshPlayer?.townHallLevel || account.townHallLevel || 12);
              const hallTag = au.village === 'builder' ? `BH${hallLevel}` : `TH${hallLevel}`;

              const embed = {
                title: `🎉 [${account.name}] Upgrade Completed!`,
                description: [
                  `Your **${au.name}** has reached **Level ${au.targetLevel}**!`,
                  '',
                  `📊 **Level ${au.targetLevel}/${au.maxLevelForTh || au.targetLevel}** for ${hallTag}`,
                ].join('\n'),
                color: COLORS.GOLD,
                thumbnail: {
                  url: CocAssetService.getThumbnail(
                    au.name,
                    au.category,
                    au.targetLevel,
                    au.village
                  ),
                },
                footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus` },
                timestamp: new Date().toISOString(),
              };

              await DiscordService.sendDm(user.discordUserId, {
                embeds: [embed],
                components: [
                  DiscordService.createActionRow([DiscordService.openGameLinkButton()]),
                ],
              });
              dmsSent++;
            }
          }
        }
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
