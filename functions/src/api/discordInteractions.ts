import { Router, Request, Response } from 'express';
import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';
import axios from 'axios';
import { config } from '../config';
import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { GeminiRoastService } from '../services/geminiRoastService';
import { DiscordService, COLORS } from '../services/discordService';
import { CocAssetService } from '../services/cocAssetService';
import {
  GameCategory,
  MAX_BUILDER_HALL,
  MAX_TOWN_HALL,
  countForHall,
  formatLevelCost,
  formatNextCost,
  getById,
  getLevel,
  getMaxLevelForHall,
  itemsIn,
} from '../services/gameDataService';
import { EMOJIS } from '../constants/emojis';
import { LinkedAccount, UserDoc } from '../types/user';
import { PlayerTrackingService } from '../services/playerTrackingService';
import { VillageImportService, InProgressUpgrade, ParsedDefenseGroup, VillageDataV2 } from '../services/villageImportService';
import { describeEvent, eventsFromImportChanges, groupWalls, isDmPaused, notifyUpgrades } from '../services/upgradeNotifier';

export const discordInteractionsRouter = Router();

// Which stored import categories each list shows
const HOME_DEFENSE_CATEGORIES: GameCategory[] = ['defense', 'trap', 'guardian', 'craftedModule'];
const BB_DEFENSE_CATEGORIES: GameCategory[] = ['defense', 'trap'];
const BUILDING_CATEGORIES: GameCategory[] = ['resource', 'army', 'other', 'wall'];

function formatProgressBar(percent: number, length: number = 10): string {
  const filled = Math.max(0, Math.min(length, Math.round((percent / 100) * length)));
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

/**
 * Handles incoming Discord HTTP interactions (Slash Commands & Message Components)
 */
discordInteractionsRouter.post('/interactions', async (req: Request, res: Response): Promise<any> => {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  const publicKey = config.discord.publicKey;

  // Always verify the cryptographic signature; without a public key, reject every request
  if (!publicKey) {
    console.error('[Discord Interactions] DISCORD_PUBLIC_KEY is not configured; rejecting request');
    return res.status(401).send('Interactions endpoint not configured');
  }
  if (!signature || !timestamp) {
    console.warn('[Discord Interactions] Missing signature or timestamp');
    return res.status(401).send('Missing signature headers');
  }
  const isValid = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    console.warn('[Discord Interactions] Invalid request signature');
    return res.status(401).send('Invalid request signature');
  }

  const interaction = req.body;
  const { type, data, member, user } = interaction;
  const discordUser = user || member?.user;
  const discordUserId = discordUser?.id;

  // 1. Handle Discord Ping
  if (type === InteractionType.PING) {
    return res.json({ type: InteractionResponseType.PONG });
  }

  // 2. Handle Application Commands (Slash Commands)
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = data;
    const optionsMap: Record<string, any> = {};
    if (options && Array.isArray(options)) {
      for (const opt of options) {
        optionsMap[opt.name] = opt.value;
      }
    }

    const cocService = new CocService();
    const isGuild = Boolean(req.body.guild_id);
    const interactionToken = req.body.token;
    const applicationId = req.body.application_id || config.discord.clientId;

    // Personal command response: if run inside a server channel, make it ephemeral (flags: 64)
    // so it doesn't spam the chat! In private DMs with Bimgus, respond normally.
    const respondPersonal = (data: any) => {
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          ...(isGuild ? { flags: 64 } : {}),
          ...data,
        },
      });
    };

    // Immediately acknowledges the interaction to satisfy Discord's 3-second hard timeout
    const deferReply = (ephemeral: boolean = isGuild) => {
      return res.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          ...(ephemeral ? { flags: 64 } : {}),
        },
      });
    };

    // Edits the initial deferred reply with the final content, embeds, and action rows
    const editDeferredReply = async (messageData: any) => {
      try {
        const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
        await axios.patch(webhookUrl, messageData, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        });
      } catch (patchErr: any) {
        console.error('[Discord] Failed to patch deferred reply:', patchErr.response?.data || patchErr.message);
      }
    };

    // Sends a follow-up message to the deferred interaction
    const sendFollowup = async (messageData: any) => {
      try {
        const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`;
        await axios.post(
          webhookUrl,
          {
            ...(isGuild ? { flags: 64 } : {}),
            ...messageData,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
          }
        );
      } catch (postErr: any) {
        console.error('[Discord] Failed to send follow-up reply:', postErr.response?.data || postErr.message);
      }
    };

    // Set by getTargetAccounts; used to tell the user once that their DMs are paused
    let commandUserDoc: UserDoc | null = null;

    // Helper to send a message per linked account (edits initial reply for 1st account, follows up for remaining)
    const sendAccountMessage = async (index: number, messageData: any) => {
      if (index === 0) {
        if (commandUserDoc && isDmPaused(commandUserDoc) && !commandUserDoc.dmsBlockedNoticeShown) {
          commandUserDoc.dmsBlockedNoticeShown = true;
          await FirestoreService.saveUser(commandUserDoc).catch(() => {});
          const notice = '📭 *Bimgus couldn\'t DM you (your DMs from this server may be closed), so upgrade DMs are paused for 7 days.*';
          messageData = { ...messageData, content: [notice, messageData.content].filter(Boolean).join('\n') };
        }
        await editDeferredReply(messageData);
      } else {
        await sendFollowup(messageData);
      }
    };

    // Helper to get all linked accounts or a specific requested account (all accounts are equal)
    async function getTargetAccounts(accountTagOption?: string): Promise<{
      userDoc: any;
      accounts: LinkedAccount[];
      error?: string;
    }> {
      if (!discordUserId) return { userDoc: null, accounts: [], error: 'Unable to identify Discord user.' };

      const userDoc = await FirestoreService.getUser(discordUserId);
      commandUserDoc = userDoc;
      if (!userDoc || !userDoc.accounts || userDoc.accounts.length === 0) {
        return {
          userDoc,
          accounts: [],
          error: '⚠️ You have not linked any Clash of Clans accounts yet! Use `/link tag:#PLAYERTAG` first.',
        };
      }

      if (accountTagOption) {
        const clean = config.formatTag(accountTagOption);
        const match = userDoc.accounts.find((a: LinkedAccount) => a.playerTag.toUpperCase() === clean.toUpperCase());
        if (!match) {
          return {
            userDoc,
            accounts: [],
            error: `⚠️ Account with tag \`${clean}\` is not linked. Use \`/accounts\` to see your linked accounts.`,
          };
        }
        return { userDoc, accounts: [match] };
      }

      // Default: all linked accounts (equal status)
      return { userDoc, accounts: userDoc.accounts };
    }

    // Helper to format date and time notice from imported village JSON
    function getVillageJsonTimestampNotice(
      village: VillageDataV2 | null,
      prefix: string = 'Based on the export taken'
    ): string | null {
      if (!village) return null;
      const sec = Math.floor(village.exportTimestamp / 1000);
      const stale = VillageImportService.isStale(village) ? ' ⚠️ *over a day old, so timers may be out of date*' : '';
      return `📄 *${prefix} on <t:${sec}:f> (<t:${sec}:R>)*${stale}`;
    }

    // Shown where imported data would be, for accounts with no import in the current format
    const NO_IMPORT_TEXT =
      '💡 *Run `/import-village` to load your exact building levels and upgrade costs. ' +
      '(Imports from before the one-file update are no longer used; one export now covers both villages.)*';

    // Helper to fetch player data with fallback to last saved snapshot during Supercell maintenance
    async function getPlayerWithFallback(account: LinkedAccount): Promise<{ player: any; isCached: boolean }> {
      try {
        const fresh = await cocService.getPlayer(account.playerTag);
        return { player: fresh, isCached: false };
      } catch (err: any) {
        const isMaintenance =
          err.response?.status === 503 ||
          err.response?.data?.reason === 'inMaintenance' ||
          err.message?.includes('503') ||
          err.message?.includes('inMaintenance');

        if (account.lastSnapshot) {
          const snap = account.lastSnapshot;
          const fallbackPlayer = {
            tag: snap.tag || account.playerTag,
            name: snap.name || account.name,
            townHallLevel: snap.townHallLevel || account.townHallLevel || 9,
            builderHallLevel: snap.builderHallLevel || account.builderHallLevel || 0,
            heroes: Object.entries(snap.heroes || {}).map(([key, h]: any) => ({
              name: h.name ?? key.replace(/^(home|builder):/, ''),
              level: h.level,
              maxLevel: h.maxLevel,
              village: h.village,
            })),
            heroEquipment: Object.entries(snap.heroEquipment || {}).map(([key, e]: any) => ({
              name: e.name ?? key.replace(/^(home|builder):/, ''),
              level: e.level,
              maxLevel: e.maxLevel,
              village: e.village,
            })),
            troops: Object.entries(snap.troops || {}).map(([key, t]: any) => ({
              name: t.name ?? key.replace(/^(home|builder):/, ''),
              level: t.level,
              maxLevel: t.maxLevel,
              village: t.village,
            })),
            spells: Object.entries(snap.spells || {}).map(([key, s]: any) => ({
              name: s.name ?? key.replace(/^(home|builder):/, ''),
              level: s.level,
              maxLevel: s.maxLevel,
              village: s.village,
            })),
            achievements: [],
          };
          return { player: fallbackPlayer, isCached: true };
        }

        if (isMaintenance) {
          throw new Error('🛠️ Clash of Clans API is currently down for maintenance by Supercell ("API is currently in maintenance, please come back later"). Please try again once maintenance concludes!');
        }
        throw err;
      }
    }

    try {
      // ----------------------------------------------------------------------
      // COMMAND: /link
      // ----------------------------------------------------------------------
      if (name === 'link') {
        const tagInput = optionsMap['tag'];
        const dmsOption = optionsMap['dms'];
        const dmsEnabled = dmsOption !== undefined ? Boolean(dmsOption) : true;

        if (!tagInput) {
          return respondPersonal({ content: '⚠️ Please provide a player tag. Example: `/link tag:#ABC123`' });
        }

        const formattedTag = config.formatTag(tagInput);
        try {
          const freshPlayer = await cocService.getPlayer(formattedTag);
          const initialSnapshot = PlayerTrackingService.createSnapshot(freshPlayer);

          const linkedAccount: LinkedAccount = {
            playerTag: freshPlayer.tag,
            name: freshPlayer.name,
            townHallLevel: freshPlayer.townHallLevel,
            builderHallLevel: freshPlayer.builderHallLevel,
            isPrimary: false,
            dmsEnabled,
            lastSnapshot: initialSnapshot,
            activeUpgrades: [],
          };

          const updatedUser = await FirestoreService.linkAccount(discordUserId, linkedAccount);

          return respondPersonal({
            embeds: [
              {
                title: '✅ Account Successfully Linked!',
                description: [
                  `**${freshPlayer.name}** (${freshPlayer.tag}) is now linked to your Discord profile!`,
                  '',
                  `🏰 **Town Hall**: TH${freshPlayer.townHallLevel}`,
                  `🔨 **Builder Hall**: BH${freshPlayer.builderHallLevel || 'N/A'}`,
                  `🏆 **Trophies**: ${freshPlayer.trophies.toLocaleString()}`,
                  `👥 **Total Linked Accounts**: ${updatedUser.accounts.length}`,
                  '',
                  `🔔 **Automated DMs**: ${dmsEnabled ? 'Enabled ✅ (War roster pings)' : 'Disabled 🔕 (No DMs will be sent)'}`,
                ].join('\n'),
                color: COLORS.GREEN,
                thumbnail: {
                  url: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
                },
                footer: { text: `Account: ${linkedAccount.name} • Bimgus Tracker` },
                timestamp: new Date().toISOString(),
              },
            ],
          });
        } catch (apiErr: any) {
          return respondPersonal({
            content: `❌ Could not find a Clash of Clans account with tag \`${formattedTag}\`. Please check the tag and try again.`,
          });
        }
      }

      // ----------------------------------------------------------------------
      // COMMAND: /unlink
      // ----------------------------------------------------------------------
      if (name === 'unlink') {
        const tagInput = optionsMap['tag'];
        const result = await FirestoreService.unlinkAccount(discordUserId, tagInput);

        if (!result.success) {
          return respondPersonal({
            content: tagInput
              ? `⚠️ Could not find linked account \`${tagInput}\` under your Discord profile. Use \`/accounts\` to check your accounts.`
              : `⚠️ You do not have any linked Clash of Clans accounts to unlink. Use \`/link\` first!`,
          });
        }

        const remainingMsg = result.remainingAccounts > 0
          ? `You have **${result.remainingAccounts}** linked account(s) remaining. Use \`/accounts\` to view them.`
          : `You have unlinked all accounts. Automatic upgrade tracking and war roster DMs have been turned off for your profile.`;

        return respondPersonal({
          embeds: [
            {
              title: '🗑️ Account Unlinked Successfully',
              description: [
                `**${result.removedName || result.removedTag}** (\`${result.removedTag}\`) has been unlinked from your Discord profile.`,
                '',
                remainingMsg,
              ].join('\n'),
              color: COLORS.RED,
              footer: { text: 'Bimgus Account Manager' },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      // ----------------------------------------------------------------------
      // COMMAND: /accounts
      // ----------------------------------------------------------------------
      if (name === 'accounts') {
        deferReply();

        (async () => {
          try {
            const { accounts, error } = await getTargetAccounts();
            if (error || !accounts || accounts.length === 0) {
              await editDeferredReply({ content: error || 'No accounts linked.' });
              return;
            }

            const accountList = accounts.map((a: LinkedAccount, idx: number) => {
              const dmBadge = a.dmsEnabled === false ? '🔕 DMs Off' : '🔔 DMs On';
              return `${idx + 1}. **${a.name}** (\`${a.playerTag}\`)\n   • Town Hall ${a.townHallLevel} | Builder Hall ${a.builderHallLevel || 'N/A'} | ${dmBadge}`;
            });

            await editDeferredReply({
              embeds: [
                {
                  title: '📋 Your Linked Clash of Clans Accounts',
                  description: [
                    `You have **${accounts.length}** account${accounts.length === 1 ? '' : 's'} linked (all equal status):`,
                    '',
                    accountList.join('\n\n'),
                    '',
                    '💡 *All linked accounts are of equal status! Commands like `/heroes`, `/sixth-builder`, and `/upgrades` automatically send an individual message for each of your linked accounts.*',
                    '',
                    '*To toggle DMs for an account, run `/link tag:#TAG dms:true|false`.*',
                  ].join('\n'),
                  color: COLORS.DISCORD_BLURPLE,
                  thumbnail: {
                    url: CocAssetService.getTownHallUrl(accounts[0].townHallLevel),
                  },
                  footer: { text: 'Bimgus Multi-Account Manager' },
                  timestamp: new Date().toISOString(),
                },
              ],
            });
          } catch (accErr: any) {
            await editDeferredReply({ content: `❌ Error loading accounts: ${accErr.message}` });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /sixth-builder
      // ----------------------------------------------------------------------
      if (name === 'sixth-builder') {
        deferReply();

        (async () => {
          try {
            const targetTag = optionsMap['account'];
            const { accounts, error } = await getTargetAccounts(targetTag);
            if (error || !accounts || accounts.length === 0) {
              await editDeferredReply({ content: error || 'No linked accounts found.' });
              return;
            }

            for (let idx = 0; idx < accounts.length; idx++) {
              const account = accounts[idx];
              try {
                const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
                const village = VillageImportService.read(account.villageData);
                const bob = PlayerTrackingService.calculateSixthBuilderProgress(
                  freshPlayer,
                  village,
                  account.bobDefenseCompleted || false
                );

                const gearUpEmoji = bob.tasks.gearUps.completed ? '✅' : '🔄';
                const troopEmoji = bob.tasks.bbTroopLv18.completed ? '✅' : '🔄';
                const defEmoji = bob.tasks.bbDefenseLv9.completed ? '✅' : '🔄';
                const heroEmoji = bob.tasks.bbHeroesLv45.completed ? '✅' : '🔄';

                const statusBanner = bob.unlocked
                  ? '🎉 **Congratulations! You have unlocked the 6th Builder (B.O.B)!**'
                  : `⏳ **Overall Progress**: ${formatProgressBar(bob.overallPercentage)}`;

                const bbJsonNotice = village && village.builderHallLevel > 0
                  ? getVillageJsonTimestampNotice(village, 'Builder Base defenses based on the export taken')
                  : null;

                const embed = {
                  title: `🛠️ [${account.name}] 6th Builder (B.O.B) Tracker`,
                  description: [
                    isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
                    statusBanner,
                    bbJsonNotice ? `${bbJsonNotice}\n` : '',
                    '',
                    `${gearUpEmoji} **1. Gear Up 3 Buildings** (${bob.tasks.gearUps.current}/${bob.tasks.gearUps.target})`,
                    `   ${bob.tasks.gearUps.description}`,
                    '',
                    `${troopEmoji} **2. Upgrade BB Troop to Level 18** (Lv ${bob.tasks.bbTroopLv18.current}/${bob.tasks.bbTroopLv18.target})`,
                    `   ${bob.tasks.bbTroopLv18.description}`,
                    '',
                    `${defEmoji} **3. Upgrade BB Defense to Level 9** (${bob.tasks.bbDefenseLv9.current}/${bob.tasks.bbDefenseLv9.target})`,
                    `   ${bob.tasks.bbDefenseLv9.description}`,
                    '',
                    `${heroEmoji} **4. Total BB Hero Level 45** (${bob.tasks.bbHeroesLv45.current}/${bob.tasks.bbHeroesLv45.target})`,
                    `   ${bob.tasks.bbHeroesLv45.description}`,
                  ].join('\n'),
                  color: bob.unlocked ? COLORS.GOLD : COLORS.BLUE,
                  thumbnail: {
                    url: CocAssetService.getBobUrl(
                      bob.unlocked ? 4 : Object.values(bob.tasks).filter((t: any) => t.completed).length
                    ),
                  },
                  footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus Tracker` },
                  timestamp: new Date().toISOString(),
                };

                const bobButtons: any[] = [];
                if ((freshPlayer.builderHallLevel || 0) >= 1) {
                  const toggleBtn = bob.tasks.bbDefenseLv9.completed
                    ? {
                        type: 2,
                        style: 2,
                        label: 'Mark Defense Lv 9 Incomplete',
                        custom_id: `bob_defense_undone:${account.playerTag}`,
                        emoji: { name: '🔄' },
                      }
                    : {
                        type: 2,
                        style: 3,
                        label: 'Mark Defense Lv 9 Completed',
                        custom_id: `bob_defense_done:${account.playerTag}`,
                        emoji: { name: '✅' },
                      };
                  bobButtons.push(toggleBtn);
                }
                bobButtons.push(DiscordService.openGameLinkButton('Open CoC'));

                await sendAccountMessage(idx, {
                  embeds: [embed],
                  components: [DiscordService.createActionRow(bobButtons)],
                });
              } catch (accountErr: any) {
                console.error(`Failed to fetch 6th builder progress for ${account.playerTag}:`, accountErr);
                await sendAccountMessage(idx, {
                  content: `❌ Could not load 6th Builder data for **${account.name}** (${account.playerTag}): ${accountErr.message || 'API error'}`,
                });
              }
            }
          } catch (cmdErr: any) {
            console.error('Failed to execute /sixth-builder:', cmdErr);
            await editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /heroes
      // ----------------------------------------------------------------------
      if (name === 'heroes') {
        deferReply();

        (async () => {
          try {
            const targetTag = optionsMap['account'];
            const villageFilter = optionsMap['village'] || 'both';
            const { accounts, error } = await getTargetAccounts(targetTag);
            if (error || !accounts || accounts.length === 0) {
              await editDeferredReply({ content: error || 'No linked accounts found.' });
              return;
            }

            for (let idx = 0; idx < accounts.length; idx++) {
              const account = accounts[idx];
              try {
                const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
                const heroSummary = PlayerTrackingService.calculateHeroesProgress(freshPlayer);

                const fields: any[] = [];

                if (villageFilter === 'home' || villageFilter === 'both') {
                  const homeList = heroSummary.homeHeroes.map((h: any) => {
                    const status = h.levelsRemaining === 0 ? '🏆 **MAXED**' : `*${h.levelsRemaining} levels left*`;
                    return `• **${h.name}**: Level **${h.level}** / ${h.maxLevel} — ${status}\n  \`${formatProgressBar(h.percentage, 10)}\``;
                  });

                  fields.push({
                    name: `🏰 Home Village Heroes (TH${freshPlayer.townHallLevel}) — ${heroSummary.overallHomePercentage}% Maxed`,
                    value: homeList.length > 0 ? homeList.join('\n\n') : 'No Home Village heroes unlocked yet.',
                    inline: false,
                  });
                }

                if (villageFilter === 'builder' || villageFilter === 'both') {
                  const builderList = heroSummary.builderHeroes.map((h: any) => {
                    const status = h.levelsRemaining === 0 ? '🏆 **MAXED**' : `*${h.levelsRemaining} levels left*`;
                    return `• **${h.name}**: Level **${h.level}** / ${h.maxLevel} — ${status}\n  \`${formatProgressBar(h.percentage, 10)}\``;
                  });

                  fields.push({
                    name: `🔨 Builder Base Heroes (BH${freshPlayer.builderHallLevel || 'N/A'}) — ${heroSummary.overallBuilderPercentage}% Maxed`,
                    value: builderList.length > 0 ? builderList.join('\n\n') : 'No Builder Base heroes unlocked yet.',
                    inline: false,
                  });
                }

                for (const f of fields) {
                  if (!f.value || !f.value.trim()) f.value = 'None';
                  if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
                }

                const embed = {
                  title: `${EMOJIS.CROWN} [${account.name}] Hero Maxing Overview`,
                  description: [
                    isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*' : '',
                    `Tracking hero levels against maximum limits for **Town Hall ${freshPlayer.townHallLevel}** and **Builder Hall ${freshPlayer.builderHallLevel || 'N/A'}**:`,
                    '',
                    `⚡ **Total Home Hero Levels Remaining**: **${heroSummary.totalHomeLevelsRemaining}**`,
                    `⚡ **Total Builder Hero Levels Remaining**: **${heroSummary.totalBuilderLevelsRemaining}**`,
                  ].filter(Boolean).join('\n'),
                  fields,
                  color: heroSummary.homeMaxed ? COLORS.GOLD : COLORS.BLUE,
                  thumbnail: {
                    url: CocAssetService.getHeroUrl('Archer Queen'),
                  },
                  footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus` },
                  timestamp: new Date().toISOString(),
                };

                await sendAccountMessage(idx, {
                  embeds: [embed],
                  components: [DiscordService.createActionRow([DiscordService.openGameLinkButton('Open CoC')])],
                });
              } catch (accountErr: any) {
                console.error(`Failed to fetch heroes for ${account.playerTag}:`, accountErr);
                await sendAccountMessage(idx, {
                  content: `❌ Could not load heroes for **${account.name}** (${account.playerTag}): ${accountErr.message || 'API error'}`,
                });
              }
            }
          } catch (cmdErr: any) {
            console.error('Failed to execute /heroes:', cmdErr);
            await editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /upgrades
      // ----------------------------------------------------------------------
      if (name === 'upgrades') {
        deferReply();

        (async () => {
          try {
            const targetTag = optionsMap['account'];
            const { accounts, error } = await getTargetAccounts(targetTag);
            if (error || !accounts || accounts.length === 0) {
              await editDeferredReply({ content: error || 'No linked accounts found.' });
              return;
            }

            for (let idx = 0; idx < accounts.length; idx++) {
              const account = accounts[idx];
              try {
                const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
                const village = VillageImportService.read(account.villageData);
                const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(
                  freshPlayer,
                  account.activeUpgrades || [],
                  account.bobDefenseCompleted || false,
                  village
                );
                const home = outstanding.byCategory.home;
                const bb = outstanding.byCategory.builder;
                const bob = bb.sixthBuilder;

                const formatItems = (
                  items: Array<{ name: string; currentLevel: number; maxLevel: number; nextCost?: string }>,
                  emptyText: string
                ) => {
                  if (items.length === 0) return emptyText || '✅ Maxed!';
                  const lines = items.map((i) => {
                    const costStr = i.nextCost ? ` — ${i.nextCost}` : '';
                    if (i.name === 'Town Hall' || i.name === 'Builder Hall') {
                      return `• **${i.name}**: ${i.currentLevel}/${i.maxLevel}${costStr}`;
                    }
                    return `• **${i.name}**: Lv ${i.currentLevel}/${i.maxLevel}${costStr}`;
                  });
                  const text = lines.join('\n');
                  if (text.length <= 900) return text;
                  let accumulated = '';
                  for (const line of lines) {
                    if ((accumulated + line + '\n').length > 850) {
                      accumulated += `... and ${lines.length - accumulated.split('\n').filter(Boolean).length} more`;
                      break;
                    }
                    accumulated += line + '\n';
                  }
                  return accumulated.trim() || emptyText || '✅ Maxed!';
                };

                const gearUpEmoji = bob.tasks.gearUps.completed ? '✅' : '🔄';
                const troopEmoji = bob.tasks.bbTroopLv18.completed ? '✅' : '🔄';
                const defEmoji = bob.tasks.bbDefenseLv9.completed ? '✅' : '🔄';
                const heroEmoji = bob.tasks.bbHeroesLv45.completed ? '✅' : '🔄';

                const sixthBuilderText = [
                  bob.unlocked
                    ? '🎉 **B.O.B Unlocked! (6th Builder Active)**'
                    : `⏳ **Progress (${bob.overallPercentage}%)**: ${formatProgressBar(bob.overallPercentage, 6)}`,
                  `${gearUpEmoji} **Gear-Ups**: ${bob.tasks.gearUps.current}/3`,
                  `${troopEmoji} **Troop Lv 18**: ${bob.tasks.bbTroopLv18.highestTroopName} (${bob.tasks.bbTroopLv18.current}/18)`,
                  `${defEmoji} **Defense Lv 9**: ${bob.tasks.bbDefenseLv9.completed ? '1/1' : '0/1 (e.g. Mega Tesla)'}`,
                  `${heroEmoji} **Heroes Lv 45**: ${bob.tasks.bbHeroesLv45.current}/45`,
                ].join('\n');

                const villageInProg: InProgressUpgrade[] = village?.inProgressUpgrades || [];
                const legacyInProg: InProgressUpgrade[] = (account.activeUpgrades || [])
                  .filter((au: any) => !au.completed && new Date(au.finishesAt).getTime() > Date.now())
                  .map((au: any) => ({
                    name: au.name,
                    dataId: au.id || '',
                    category: (au.category || 'building') as any,
                    village: au.village || 'home',
                    currentLevel: Math.max(0, au.targetLevel - 1),
                    targetLevel: au.targetLevel,
                    maxLevel: au.maxLevelForTh || au.targetLevel,
                    timerSeconds: Math.max(0, Math.floor((new Date(au.finishesAt).getTime() - Date.now()) / 1000)),
                    finishesAtMs: new Date(au.finishesAt).getTime(),
                  }));

                const combinedInProg = [...villageInProg, ...legacyInProg];
                const seenInProg = new Set<string>();
                const activeInProgress = combinedInProg
                  .filter((u) => {
                    if (u.finishesAtMs <= Date.now()) return false;
                    const k = `${u.name}_${u.targetLevel}`;
                    if (seenInProg.has(k)) return false;
                    seenInProg.add(k);
                    return true;
                  })
                  .sort((a, b) => a.finishesAtMs - b.finishesAtMs);

                const halls = { townHall: freshPlayer.townHallLevel, builderHall: freshPlayer.builderHallLevel || 0 };
                const importedHome: ParsedDefenseGroup[] = village
                  ? VillageImportService.groupsFor(village, 'home', HOME_DEFENSE_CATEGORIES, halls)
                  : [];
                const unmaxedHomeDef = importedHome.filter((d) => !d.isMaxed);

                const importedHomeBuildings: ParsedDefenseGroup[] = village
                  ? VillageImportService.groupsFor(village, 'home', BUILDING_CATEGORIES, halls)
                  : [];
                const unmaxedHomeBuildings = importedHomeBuildings.filter((d) => !d.isMaxed);

                const importedBb: ParsedDefenseGroup[] = village
                  ? VillageImportService.groupsFor(village, 'builder', [...BB_DEFENSE_CATEGORIES, ...BUILDING_CATEGORIES], halls)
                  : [];
                const unmaxedBbDef = importedBb.filter((d) => !d.isMaxed);

                const unmaxedBuildingLines = unmaxedHomeBuildings.map(VillageImportService.formatGroupLine);
                const thGearUpText = formatItems(home.buildings, '');
                const homeBuildingLines = [thGearUpText, ...unmaxedBuildingLines].filter(Boolean);
                const homeBuildingFields: any[] = [];
                const totalBuildingsCount = home.buildings.length + unmaxedHomeBuildings.length;

                if (homeBuildingLines.length === 0) {
                  homeBuildingFields.push({
                    name: `🏛️ Buildings & Storages (0)`,
                    value: '✅ All buildings, storages & gear-ups maxed!',
                    inline: false,
                  });
                } else {
                  let bChunk: string[] = [];
                  let bChunkLen = 0;
                  let bPart = 1;
                  for (const line of homeBuildingLines) {
                    if (bChunkLen + line.length + 1 > 900 && bChunk.length > 0) {
                      homeBuildingFields.push({
                        name: bPart === 1 ? `🏛️ Buildings & Storages (${totalBuildingsCount})` : `🏛️ Buildings & Storages (Cont. ${bPart})`,
                        value: bChunk.join('\n'),
                        inline: false,
                      });
                      bChunk = [];
                      bChunkLen = 0;
                      bPart++;
                    }
                    bChunk.push(line);
                    bChunkLen += line.length + 1;
                  }
                  if (bChunk.length > 0) {
                    homeBuildingFields.push({
                      name: bPart === 1 ? `🏛️ Buildings & Storages (${totalBuildingsCount})` : `🏛️ Buildings & Storages (Cont. ${bPart})`,
                      value: bChunk.join('\n'),
                      inline: false,
                    });
                  }
                }

                const bbBuildingText = formatItems(bb.buildings, `✅ Builder Hall maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`);

                const homeDefFields: any[] = [];
                if (importedHome.length > 0) {
                  if (unmaxedHomeDef.length > 0) {
                    const homeDefLines = unmaxedHomeDef.map(VillageImportService.formatGroupLine);
                    let chunk: string[] = [];
                    let chunkLen = 0;
                    let part = 1;
                    for (const line of homeDefLines) {
                      if (chunkLen + line.length + 1 > 900 && chunk.length > 0) {
                        homeDefFields.push({
                          name: part === 1 ? `🛡️ Defenses (${unmaxedHomeDef.length})` : `🛡️ Defenses (Cont. ${part})`,
                          value: chunk.join('\n'),
                          inline: false,
                        });
                        chunk = [];
                        chunkLen = 0;
                        part++;
                      }
                      chunk.push(line);
                      chunkLen += line.length + 1;
                    }
                    if (chunk.length > 0) {
                      homeDefFields.push({
                        name: part === 1 ? `🛡️ Defenses (${unmaxedHomeDef.length})` : `🛡️ Defenses (Cont. ${part})`,
                        value: chunk.join('\n'),
                        inline: false,
                      });
                    }
                  } else {
                    homeDefFields.push({
                      name: `🛡️ Defenses (0)`,
                      value: `✅ All home defenses maxed for TH${freshPlayer.townHallLevel}!`,
                      inline: false,
                    });
                  }
                } else {
                  homeDefFields.push({
                    name: `🛡️ Defenses`,
                    value: NO_IMPORT_TEXT,
                    inline: false,
                  });
                }

                const bbDefFields: any[] = [];
                if (importedBb.length > 0) {
                  if (unmaxedBbDef.length > 0) {
                    const bbDefLines = unmaxedBbDef.map(VillageImportService.formatGroupLine);
                    let bbChunk: string[] = [];
                    let bbChunkLen = 0;
                    let bbPart = 1;
                    for (const line of bbDefLines) {
                      if (bbChunkLen + line.length + 1 > 900 && bbChunk.length > 0) {
                        bbDefFields.push({
                          name: bbPart === 1 ? `🛡️ BB Defenses (${unmaxedBbDef.length})` : `🛡️ BB Defenses (Cont. ${bbPart})`,
                          value: bbChunk.join('\n'),
                          inline: false,
                        });
                        bbChunk = [];
                        bbChunkLen = 0;
                        bbPart++;
                      }
                      bbChunk.push(line);
                      bbChunkLen += line.length + 1;
                    }
                    if (bbChunk.length > 0) {
                      bbDefFields.push({
                        name: bbPart === 1 ? `🛡️ BB Defenses (${unmaxedBbDef.length})` : `🛡️ BB Defenses (Cont. ${bbPart})`,
                        value: bbChunk.join('\n'),
                        inline: false,
                      });
                    }
                  } else {
                    bbDefFields.push({
                      name: `🛡️ BB Defenses (0)`,
                      value: `✅ All BB defenses maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`,
                      inline: false,
                    });
                  }
                } else {
                  bbDefFields.push({
                    name: `🛡️ BB Defenses`,
                    value: NO_IMPORT_TEXT,
                    inline: false,
                  });
                }

                let totalOutstandingLevels = outstanding.totalRemainingLevels;
                if (importedHome.length > 0) {
                  for (const d of unmaxedHomeDef) {
                    totalOutstandingLevels += d.count * Math.max(0, d.maxLevel - d.currentLevel);
                  }
                }
                if (importedHomeBuildings.length > 0) {
                  for (const d of unmaxedHomeBuildings) {
                    totalOutstandingLevels += d.count * Math.max(0, d.maxLevel - d.currentLevel);
                  }
                }
                if (importedBb.length > 0) {
                  for (const d of unmaxedBbDef) {
                    totalOutstandingLevels += d.count * Math.max(0, d.maxLevel - d.currentLevel);
                  }
                }

                const fields: any[] = [];

                if (activeInProgress.length > 0) {
                  const timerText = VillageImportService.formatInProgressUpgrades(activeInProgress);
                  fields.push({
                    name: `⏳ In-Progress Upgrades (${activeInProgress.length})`,
                    value: timerText.length > 1024 ? timerText.slice(0, 1020) + '...' : timerText,
                    inline: false,
                  });
                }

                fields.push(
                  // PART 1: HOME VILLAGE
                  {
                    name: `🏰 ━━━━ HOME VILLAGE (TH${freshPlayer.townHallLevel}) ━━━━`,
                    value: `Research & upgrades remaining to max Town Hall ${freshPlayer.townHallLevel}:`,
                    inline: false,
                  },
                  ...homeBuildingFields,
                  ...homeDefFields,
                  {
                    name: `${EMOJIS.CROWN} Heroes (${home.heroes.length})`,
                    value: formatItems(home.heroes, `✅ All heroes maxed for TH${freshPlayer.townHallLevel}!`),
                    inline: false,
                  },
                  {
                    name: `${EMOJIS.ANVIL} Hero Equipment (${home.equipment.length})`,
                    value: formatItems(home.equipment, `✅ All equipment maxed for TH${freshPlayer.townHallLevel}!`),
                    inline: false,
                  },
                  {
                    name: `🧪 Spells (${home.spells.length})`,
                    value: formatItems(home.spells, `✅ All spells maxed for TH${freshPlayer.townHallLevel}!`),
                    inline: false,
                  },
                  {
                    name: `⚔️ Troops (${home.troops.length})`,
                    value: formatItems(home.troops, `✅ All troops maxed for TH${freshPlayer.townHallLevel}!`),
                    inline: false,
                  },

                  // PART 2: BUILDER BASE
                  {
                    name: `🔨 ━━━━ BUILDER BASE (BH${freshPlayer.builderHallLevel || 'N/A'}) ━━━━`,
                    value: `Research & upgrades remaining to max Builder Hall ${freshPlayer.builderHallLevel || 'N/A'}:`,
                    inline: false,
                  },
                  {
                    name: `🤖 6th Builder (B.O.B) Tracker`,
                    value: sixthBuilderText,
                    inline: false,
                  },
                  {
                    name: `🏛️ BB Buildings (${bb.buildings.length})`,
                    value: bbBuildingText,
                    inline: false,
                  },
                  ...bbDefFields,
                  {
                    name: `${EMOJIS.CROWN} BB Heroes (${bb.heroes.length})`,
                    value: formatItems(bb.heroes, `✅ All BB heroes maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`),
                    inline: false,
                  },
                  {
                    name: `⚔️ BB Troops (${bb.troops.length})`,
                    value: formatItems(bb.troops, `✅ All BB troops maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`),
                    inline: false,
                  }
                );

                for (const f of fields) {
                  if (!f.value || !f.value.trim()) f.value = '✅ Maxed!';
                  if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
                }

                const jsonNotice = getVillageJsonTimestampNotice(village, 'Defenses & buildings based on the export taken');

                const embed = {
                  title: `🏰 [${account.name}] Live Upgrades & Maxing Overview`,
                  description: [
                    isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
                    'Real-time progression synchronized directly from official Clash of Clans API.',
                    jsonNotice || '',
                    `*Total Outstanding Levels: **${totalOutstandingLevels}***`,
                  ].filter(Boolean).join('\n'),
                  fields,
                  color: COLORS.GOLD,
                  thumbnail: {
                    url:
                      CocAssetService.getPlayerLeagueUrl(freshPlayer) ||
                      CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
                  },
                  footer: { text: `Town Hall ${freshPlayer.townHallLevel} • Builder Hall ${freshPlayer.builderHallLevel || 'N/A'} • Account: ${account.name} (${account.playerTag})` },
                  timestamp: new Date().toISOString(),
                };

                const upgradeButtons: any[] = [];
                if ((freshPlayer.builderHallLevel || 0) >= 1) {
                  const toggleBtn = bob.tasks.bbDefenseLv9.completed
                    ? {
                        type: 2,
                        style: 2,
                        label: 'Mark BB Def Lv 9 Incomplete',
                        custom_id: `bob_defense_undone:${account.playerTag}`,
                        emoji: { name: '🔄' },
                      }
                    : {
                        type: 2,
                        style: 3,
                        label: 'Mark BB Def Lv 9 Done',
                        custom_id: `bob_defense_done:${account.playerTag}`,
                        emoji: { name: '✅' },
                      };
                  upgradeButtons.push(toggleBtn);
                }
                upgradeButtons.push(DiscordService.openGameLinkButton('Open CoC'));

                await sendAccountMessage(idx, {
                  embeds: [embed],
                  components: [DiscordService.createActionRow(upgradeButtons)],
                });
              } catch (accountErr: any) {
                console.error(`Failed to fetch upgrades for ${account.playerTag}:`, accountErr);
                await sendAccountMessage(idx, {
                  content: `❌ Could not load upgrades for **${account.name}** (${account.playerTag}): ${accountErr.message || 'API error'}`,
                });
              }
            }
          } catch (cmdErr: any) {
            console.error('Failed to execute /upgrades:', cmdErr);
            await editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /defenses
      // ----------------------------------------------------------------------
      if (name === 'defenses') {
        deferReply();

        (async () => {
          try {
            const targetTag = optionsMap['account'];
            const { accounts, error } = await getTargetAccounts(targetTag);
            if (error || !accounts || accounts.length === 0) {
              await editDeferredReply({ content: error || 'No linked accounts found.' });
              return;
            }

            for (let idx = 0; idx < accounts.length; idx++) {
              const account = accounts[idx];
              try {
                const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
                const th = freshPlayer.townHallLevel;
                const bh = freshPlayer.builderHallLevel || 0;
                const village = VillageImportService.read(account.villageData);
                const halls = { townHall: th, builderHall: bh };
                // Without an import, list every defense the hall allows with its cap and the cost of its last level
                const hallCapLines = (village: 'home' | 'builder', hallLevel: number) =>
                  itemsIn(village, ['defense'])
                    .map((item) => ({ item, count: countForHall(item, hallLevel), max: getMaxLevelForHall(item, hallLevel) }))
                    .filter((d) => d.count > 0 && d.max > 0)
                    .map((d) => {
                      const last = getLevel(d.item, d.max);
                      return `• ${d.count}x **${d.item.displayName}**: Max Lv ${d.max}${last ? ` — ${formatLevelCost(d.item, last)}` : ''}`;
                    });

                const villageInProg: InProgressUpgrade[] = village?.inProgressUpgrades || [];
                const legacyInProg: InProgressUpgrade[] = (account.activeUpgrades || [])
                  .filter((au: any) => !au.completed && new Date(au.finishesAt).getTime() > Date.now())
                  .map((au: any) => ({
                    name: au.name,
                    dataId: au.id || '',
                    category: (au.category || 'building') as any,
                    village: au.village || 'home',
                    currentLevel: Math.max(0, au.targetLevel - 1),
                    targetLevel: au.targetLevel,
                    maxLevel: au.maxLevelForTh || au.targetLevel,
                    timerSeconds: Math.max(0, Math.floor((new Date(au.finishesAt).getTime() - Date.now()) / 1000)),
                    finishesAtMs: new Date(au.finishesAt).getTime(),
                  }));

                const combinedInProg = [...villageInProg, ...legacyInProg];
                const seenInProg = new Set<string>();
                const activeInProgress = combinedInProg
                  .filter((u) => {
                    if (u.finishesAtMs <= Date.now()) return false;
                    const k = `${u.name}_${u.targetLevel}`;
                    if (seenInProg.has(k)) return false;
                    seenInProg.add(k);
                    return true;
                  })
                  .sort((a, b) => a.finishesAtMs - b.finishesAtMs);

                // Town Hall Status
                const townHall = getById(1000001);
                const thUpgradeCost = townHall ? formatNextCost(townHall, th) : '';
                const thUpgradeStr = th >= MAX_TOWN_HALL
                  ? `🏆 **Town Hall**: Maxed (TH${MAX_TOWN_HALL})`
                  : `• **Town Hall**: 0/1${thUpgradeCost ? ` — ${thUpgradeCost}` : ''}`;

                // High Gear achievement
                const highGear = (freshPlayer.achievements || []).find((a: any) => a.name === 'High Gear');
                const gearUpsCount = highGear ? Math.min(3, highGear.value || 0) : 0;
                const gearUpsStr = gearUpsCount >= 3
                  ? '✅ **Home Defense Gear-Ups**: 3/3 (Cannon, Archer Tower, Mortar)'
                  : `• **Defense Gear-Ups**: ${gearUpsCount}/3 (Cannon, Archer Tower, Mortar)`;

                // Defense lines: use imported village data if available, otherwise show target caps
                const importedHome = village ? VillageImportService.groupsFor(village, 'home', HOME_DEFENSE_CATEGORIES, halls) : [];
                const homeCapLines = importedHome.length > 0
                  ? importedHome.map(VillageImportService.formatGroupLine)
                  : hallCapLines('home', th);

                const fields: any[] = [];

                if (activeInProgress.length > 0) {
                  const timerText = VillageImportService.formatInProgressUpgrades(activeInProgress);
                  fields.push({
                    name: `⏳ In-Progress Upgrades (${activeInProgress.length})`,
                    value: timerText.length > 1024 ? timerText.slice(0, 1020) + '...' : timerText,
                    inline: false,
                  });
                }

                const homeHeader = [
                  thUpgradeStr,
                  gearUpsStr,
                  '',
                  `🛡️ **${importedHome.length > 0 ? 'Current Defenses & Next Upgrades' : `Defense Upgrades to Max TH${th}`}:**`,
                ].join('\n');

                const homeChunks: string[] = [];
                let curChunk = '';
                for (const line of homeCapLines) {
                  if ((curChunk + line + '\n').length > 850 && curChunk.length > 0) {
                    homeChunks.push(curChunk.trim());
                    curChunk = '';
                  }
                  curChunk += line + '\n';
                }
                if (curChunk.trim().length > 0) {
                  homeChunks.push(curChunk.trim());
                }

                if (homeChunks.length <= 1) {
                  fields.push({
                    name: `🏰 Home Village Defenses (TH${th})`,
                    value: [homeHeader, homeChunks[0] || 'No defenses recorded.'].join('\n'),
                    inline: false,
                  });
                } else {
                  fields.push({
                    name: `🏰 Home Village Defenses (TH${th})`,
                    value: [homeHeader, homeChunks[0]].join('\n'),
                    inline: false,
                  });
                  for (let c = 1; c < homeChunks.length; c++) {
                    fields.push({
                      name: `🏰 Home Village Defenses (TH${th} Cont. ${c + 1})`,
                      value: homeChunks[c],
                      inline: false,
                    });
                  }
                }

                const importedBuildings = village ? VillageImportService.groupsFor(village, 'home', BUILDING_CATEGORIES, halls) : [];
                if (importedBuildings.length > 0) {
                  fields.push(
                    ...VillageImportService.linesToFields(
                      `🏛️ Other Buildings & Storages (TH${th})`,
                      importedBuildings.map(VillageImportService.formatGroupLine)
                    )
                  );
                }

                let bob: any = null;
                if (bh > 0) {
                  const builderHall = getById(1000034);
                  const bhUpgradeCost = builderHall ? formatNextCost(builderHall, bh) : '';
                  const bhUpgradeStr = bh >= MAX_BUILDER_HALL
                    ? `🏆 **Builder Hall**: Maxed (BH${MAX_BUILDER_HALL})`
                    : `• **Builder Hall**: 0/1${bhUpgradeCost ? ` — ${bhUpgradeCost}` : ''}`;

                  bob = PlayerTrackingService.calculateSixthBuilderProgress(
                    freshPlayer,
                    village,
                    account.bobDefenseCompleted || false
                  );
                  const bobDefStr = bob.tasks.bbDefenseLv9.completed
                    ? '✅ **B.O.B Defense Lv 9**: Completed'
                    : `🔄 **B.O.B Defense Lv 9**: 0/1 (Upgrade any BB defense to Lv 9)`;

                  const importedBb = village ? VillageImportService.groupsFor(village, 'builder', BB_DEFENSE_CATEGORIES, halls) : [];
                  const bbCapLines = importedBb.length > 0
                    ? importedBb.map(VillageImportService.formatGroupLine)
                    : hallCapLines('builder', bh);

                  const bbHeader = [
                    bhUpgradeStr,
                    bobDefStr,
                    '',
                    `🛡️ **${importedBb.length > 0 ? 'Current Defenses & Next Upgrades' : `Defense Upgrades to Max BH${bh}`}:**`,
                  ].join('\n');

                  const bbChunks: string[] = [];
                  let curBbChunk = '';
                  for (const line of bbCapLines) {
                    if ((curBbChunk + line + '\n').length > 850 && curBbChunk.length > 0) {
                      bbChunks.push(curBbChunk.trim());
                      curBbChunk = '';
                    }
                    curBbChunk += line + '\n';
                  }
                  if (curBbChunk.trim().length > 0) {
                    bbChunks.push(curBbChunk.trim());
                  }

                  if (bbChunks.length <= 1) {
                    fields.push({
                      name: `🔨 Builder Base Defenses (BH${bh})`,
                      value: [bbHeader, bbChunks[0] || 'No builder defenses recorded.'].join('\n'),
                      inline: false,
                    });
                  } else {
                    fields.push({
                      name: `🔨 Builder Base Defenses (BH${bh})`,
                      value: [bbHeader, bbChunks[0]].join('\n'),
                      inline: false,
                    });
                    for (let c = 1; c < bbChunks.length; c++) {
                      fields.push({
                        name: `🔨 Builder Base Defenses (BH${bh} Cont. ${c + 1})`,
                        value: bbChunks[c],
                        inline: false,
                      });
                    }
                  }
                }

                for (const f of fields) {
                  if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
                }

                const hasImportedHome = importedHome.length > 0;
                const hasImportedBb = Boolean(village && village.builderHallLevel > 0);
                const hasImported = Boolean(village);
                const jsonNotice = getVillageJsonTimestampNotice(village);
                const desc = [
                  isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
                  hasImportedHome
                    ? (hasImportedBb
                        ? `Exact defenses for **Town Hall ${th}** and **Builder Hall ${bh}**.`
                        : `Exact defenses for **Town Hall ${th}**.`)
                    : `Defense level limits and Hall upgrade requirements for **Town Hall ${th}**${bh > 0 ? ` and **Builder Hall ${bh}**` : ''}.\n*(The Supercell API doesn't include building levels.)*\n${NO_IMPORT_TEXT}`,
                  jsonNotice || '',
                ].filter(Boolean).join('\n');

                const embed = {
                  title: `🛡️ [${account.name}] Defense ${hasImported ? 'Levels & Upgrades' : '& Hall Maxing Targets'}`,
                  description: desc,
                  color: COLORS.GOLD,
                  fields,
                  thumbnail: { url: CocAssetService.getTownHallUrl(th) },
                  footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus Tracker` },
                  timestamp: new Date().toISOString(),
                };

                const defButtons: any[] = [];
                if (bh >= 1 && bob) {
                  const toggleBtn = bob.tasks.bbDefenseLv9.completed
                    ? {
                        type: 2,
                        style: 2,
                        label: 'Mark BB Def Lv 9 Incomplete',
                        custom_id: `bob_defense_undone:${account.playerTag}`,
                        emoji: { name: '🔄' },
                      }
                    : {
                        type: 2,
                        style: 3,
                        label: 'Mark BB Def Lv 9 Done',
                        custom_id: `bob_defense_done:${account.playerTag}`,
                        emoji: { name: '✅' },
                      };
                  defButtons.push(toggleBtn);
                }
                defButtons.push(DiscordService.openGameLinkButton('Open CoC'));

                await sendAccountMessage(idx, {
                  embeds: [embed],
                  components: [DiscordService.createActionRow(defButtons)],
                });
              } catch (accountErr: any) {
                console.error(`Failed to fetch defenses for ${account.playerTag}:`, accountErr);
                await sendAccountMessage(idx, {
                  content: `❌ Could not load defense data for **${account.name}** (${account.playerTag}): ${accountErr.message || 'API error'}`,
                });
              }
            }
          } catch (cmdErr: any) {
            console.error('Failed to execute /defenses:', cmdErr);
            await editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /import-village
      // ----------------------------------------------------------------------
      if (name === 'import-village') {
        const jsonText = optionsMap['json_text'];
        const targetTag = optionsMap['account'];

        // Gather all attachments from file, file2, file3, file4, file5, file6, and resolved
        const resolvedAttachments = data.resolved?.attachments || {};
        const attachmentIds: string[] = [];
        for (const optKey of ['file', 'file2', 'file3', 'file4', 'file5', 'file6']) {
          if (optionsMap[optKey] && !attachmentIds.includes(optionsMap[optKey])) {
            attachmentIds.push(optionsMap[optKey]);
          }
        }
        for (const attId of Object.keys(resolvedAttachments)) {
          if (!attachmentIds.includes(attId)) {
            attachmentIds.push(attId);
          }
        }

        const attachments = attachmentIds
          .map((id) => resolvedAttachments[id])
          .filter((att) => att && att.url);

        if (attachments.length === 0 && !jsonText) {
          return respondPersonal({
            content:
              '⚠️ **Please provide your village JSON export!**\n\n' +
              '• **One export per account; it includes both your Home Village and Builder Base.**\n' +
              '• Attach up to 6 `.json` files at once if you have several accounts, or paste one export into the `json_text` option.\n\n' +
              '📖 **How to export from Clash of Clans:**\n' +
              '1. Open Clash of Clans ➔ Tap **Settings** ⚙️\n' +
              '2. Tap **More Settings**\n' +
              '3. Scroll to the bottom to **Data Export**\n' +
              '4. Tap **Copy** next to *"Export village data in JSON format"*',
          });
        }

        deferReply();

        (async () => {
          try {
            // 1. Download all attachment files
            const rawInputs: Array<{ name: string; raw: string }> = [];
            if (jsonText) {
              rawInputs.push({ name: 'pasted_json_text', raw: jsonText });
            }

            if (attachments.length > 0) {
              const downloaded = await Promise.all(
                attachments.map(async (att) => {
                  try {
                    const res = await axios.get(att.url, { responseType: 'text', timeout: 15000 });
                    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
                    return { name: att.filename || att.id, raw };
                  } catch (dlErr: any) {
                    console.warn(`Failed to download attachment ${att.id}:`, dlErr.message);
                    return null;
                  }
                })
              );
              for (const d of downloaded) {
                if (d) rawInputs.push(d);
              }
            }

            if (rawInputs.length === 0) {
              await editDeferredReply({
                content: '❌ Failed to read or download the provided file(s). Please check your upload and try again.',
              });
              return;
            }

            // 2. Parse every export; each one is a whole account (both villages)
            const parsed: Array<{ fileName: string; village: VillageDataV2 }> = [];
            const parseErrors: string[] = [];
            for (const item of rawInputs) {
              try {
                const json = VillageImportService.parseRawJson(item.raw);
                parsed.push({ fileName: item.name, village: VillageImportService.parseExport(json) });
              } catch (pErr: any) {
                parseErrors.push(`• **${item.name}**: ${pErr.message}`);
              }
            }

            if (parsed.length === 0) {
              await editDeferredReply({
                content: `❌ Could not read any village exports:\n${parseErrors.join('\n')}`,
              });
              return;
            }

            // 3. Load user's linked accounts
            const user = discordUserId ? await FirestoreService.getUser(discordUserId) : null;
            const userAccounts = user?.accounts || [];
            if (!user || userAccounts.length === 0) {
              await editDeferredReply({
                content: '❌ No linked accounts found. Please `/link` your Clash of Clans account first!',
              });
              return;
            }

            // 4. Match each export to an account by its tag (newest export wins per account)
            const { byAccount, unmapped, notices } = VillageImportService.matchExportsToAccounts(
              parsed,
              userAccounts,
              targetTag ? config.formatTag(targetTag) : undefined
            );

            if (byAccount.size === 0) {
              await editDeferredReply({
                content:
                  `❌ None of the uploaded files could be matched to your linked accounts (${userAccounts.map((a) => a.playerTag).join(', ')}).\n` +
                  (unmapped.length > 0 ? `Unmatched: ${unmapped.join(', ')}` : ''),
              });
              return;
            }

            // 5. Each export replaces that account's stored data
            const embedsToSend: any[] = [];
            for (const { account, village, fileName } of byAccount.values()) {
              // Compare with what was stored *before* overwriting it
              const previous = VillageImportService.read(account.villageData);
              const changes = VillageImportService.detectImportChanges(previous, village);
              const events = eventsFromImportChanges(changes, village);

              account.villageData = village;
              if (events.length > 0) await notifyUpgrades(user, account, events);

              const fields: any[] = [];
              const activeInProg = village.inProgressUpgrades.filter((u) => u.finishesAtMs > Date.now());
              if (activeInProg.length > 0) {
                fields.push(
                  ...VillageImportService.linesToFields(
                    `⏳ In-Progress Upgrades (${activeInProg.length})`,
                    VillageImportService.formatInProgressUpgrades(activeInProg).split('\n')
                  )
                );
              }
              if (events.length > 0) {
                fields.push(...VillageImportService.linesToFields(`🎉 Changes Since Your Last Import (${events.length})`, groupWalls(events).map(describeEvent)));
              }
              const weapon = VillageImportService.weaponFor(village);
              if (weapon) {
                fields.push({ name: '🔥 Town Hall Weapon', value: `• **${weapon.name}**: Lv ${weapon.level}/${weapon.maxLevel}`, inline: false });
              }
              for (const section of VillageImportService.importSections(village)) {
                fields.push(...VillageImportService.linesToFields(section.title, section.lines));
              }

              const exportSec = Math.floor(village.exportTimestamp / 1000);
              const staleWarning = VillageImportService.isStale(village)
                ? '\n⚠️ *This export is over a day old, so its timers may be out of date. Export again for accurate timers.*'
                : '';
              embedsToSend.push(
                ...VillageImportService.fieldsToEmbeds(
                  {
                    title: `🛡️ [${account.name}] Imported Village`,
                    description:
                      `Town Hall **${village.townHallLevel}**${village.builderHallLevel ? ` and Builder Hall **${village.builderHallLevel}**` : ''}, from one export.\n` +
                      `📄 *Export taken <t:${exportSec}:f> (<t:${exportSec}:R>)*${staleWarning}`,
                    color: COLORS.GOLD,
                    thumbnail: { url: CocAssetService.getTownHallUrl(village.townHallLevel) },
                    footer: { text: `Account: ${account.name} (${account.playerTag}) • ${fileName}` },
                  },
                  fields
                )
              );
            }

            // One save for the whole user (all accounts, notified keys and any DM pause)
            await FirestoreService.saveUser(user);

            if (unmapped.length > 0) {
              notices.push(`⚠️ These exports didn't match a linked account and were skipped: ${unmapped.join(', ')}`);
            }
            if (parseErrors.length > 0) {
              notices.push(`⚠️ Couldn't read:\n${parseErrors.join('\n')}`);
            }

            // Discord allows 10 embeds per message; send the rest as follow-ups
            const components = [DiscordService.createActionRow([DiscordService.openGameLinkButton('Open CoC')])];
            await editDeferredReply({
              content: notices.join('\n').slice(0, 1900) || undefined,
              embeds: embedsToSend.slice(0, 10),
              components,
            });
            for (let i = 10; i < embedsToSend.length; i += 10) {
              await sendFollowup({ embeds: embedsToSend.slice(i, i + 10) });
            }
          } catch (importErr: any) {
            console.error('Failed to execute /import-village:', importErr);
            await editDeferredReply({
              content: `❌ Error importing village data: ${importErr.message || 'Unknown error'}`,
            });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /spells
      // ----------------------------------------------------------------------
      if (name === 'spells') {
        deferReply();

        (async () => {
          try {
            const targetTag = optionsMap['account'];
            const { accounts, error } = await getTargetAccounts(targetTag);
            if (error || !accounts || accounts.length === 0) {
              await editDeferredReply({ content: error || 'No linked accounts found.' });
              return;
            }

            for (let idx = 0; idx < accounts.length; idx++) {
              const account = accounts[idx];
              try {
                const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
                const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(freshPlayer, account.activeUpgrades || []);
                const spells = outstanding.byCategory.home.spells;

                const elixirSpells = spells.filter((s) => s.resourceType === 'elixir');
                const darkSpells = spells.filter((s) => s.resourceType === 'darkElixir');

                const formatSpellList = (list: typeof spells) => {
                  if (list.length === 0) return '✅ All maxed for this Town Hall!';
                  return list
                    .map((s) => {
                      const costStr = s.nextCost ? ` — ${s.nextCost}` : '';
                      return `• **${s.name}**: Lv ${s.currentLevel}/${s.maxLevel}${costStr}`;
                    })
                    .join('\n');
                };

                const fields: any[] = [
                  {
                    name: `💧 Elixir Spells (${elixirSpells.length} remaining)`,
                    value: formatSpellList(elixirSpells),
                    inline: false,
                  },
                  {
                    name: `⬛ Dark Elixir Spells (${darkSpells.length} remaining)`,
                    value: formatSpellList(darkSpells),
                    inline: false,
                  },
                ];

                for (const f of fields) {
                  if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
                }

                const totalSpellLevels = spells.reduce((acc, s) => acc + s.levelsRemaining, 0);

                const embed = {
                  title: `🧪 [${account.name}] Spell Laboratory Upgrades`,
                  description: [
                    isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
                    `Research remaining to max all Spells for **Town Hall ${freshPlayer.townHallLevel}**:`,
                    '',
                    totalSpellLevels === 0
                      ? '🎉 **All spells are currently maxed for your Town Hall level!**'
                      : `⚡ **Total Outstanding Spell Levels**: **${totalSpellLevels}**`,
                  ].filter(Boolean).join('\n'),
                  color: totalSpellLevels === 0 ? COLORS.GREEN : COLORS.PURPLE,
                  fields,
                  thumbnail: { url: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel) },
                  footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus Tracker` },
                  timestamp: new Date().toISOString(),
                };

                await sendAccountMessage(idx, {
                  embeds: [embed],
                  components: [DiscordService.createActionRow([DiscordService.openGameLinkButton('Open CoC')])],
                });
              } catch (accountErr: any) {
                console.error(`Failed to fetch spells for ${account.playerTag}:`, accountErr);
                await sendAccountMessage(idx, {
                  content: `❌ Could not load spell data for **${account.name}** (${account.playerTag}): ${accountErr.message || 'API error'}`,
                });
              }
            }
          } catch (cmdErr: any) {
            console.error('Failed to execute /spells:', cmdErr);
            await editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /troops
      // ----------------------------------------------------------------------
      if (name === 'troops') {
        deferReply();

        (async () => {
          try {
            const targetTag = optionsMap['account'];
            const villageFilter = optionsMap['village'] || 'both';
            const { accounts, error } = await getTargetAccounts(targetTag);
            if (error || !accounts || accounts.length === 0) {
              await editDeferredReply({ content: error || 'No linked accounts found.' });
              return;
            }

            for (let idx = 0; idx < accounts.length; idx++) {
              const account = accounts[idx];
              try {
                const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
                const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(freshPlayer, account.activeUpgrades || []);

                const homeTroops = outstanding.byCategory.home.troops;
                const builderTroops = outstanding.byCategory.builder.troops;

                const fields: any[] = [];

                if (villageFilter === 'home' || villageFilter === 'both') {
                  const formatHomeList = () => {
                    if (homeTroops.length === 0) return `🎉 All Home Village troops maxed for TH${freshPlayer.townHallLevel}!`;
                    const lines = homeTroops.map((t) => {
                      const costStr = t.nextCost ? ` — ${t.nextCost}` : '';
                      return `• **${t.name}**: Lv ${t.currentLevel}/${t.maxLevel}${costStr}`;
                    });
                    const full = lines.join('\n');
                    if (full.length <= 1000) return full;
                    let truncated = '';
                    for (const l of lines) {
                      if ((truncated + l + '\n').length > 950) {
                        truncated += `... and ${lines.length - truncated.split('\n').filter(Boolean).length} more`;
                        break;
                      }
                      truncated += l + '\n';
                    }
                    return truncated.trim();
                  };

                  fields.push({
                    name: `🏰 Home Village Troops (TH${freshPlayer.townHallLevel}) — ${homeTroops.length} Upgrades Remaining`,
                    value: formatHomeList(),
                    inline: false,
                  });
                }

                if ((villageFilter === 'builder' || villageFilter === 'both') && freshPlayer.builderHallLevel) {
                  const formatBuilderList = () => {
                    if (builderTroops.length === 0) return `🎉 All Builder Base troops maxed for BH${freshPlayer.builderHallLevel}!`;
                    const lines = builderTroops.map((t) => {
                      const costStr = t.nextCost ? ` — ${t.nextCost}` : '';
                      return `• **${t.name}**: Lv ${t.currentLevel}/${t.maxLevel}${costStr}`;
                    });
                    const full = lines.join('\n');
                    if (full.length <= 1000) return full;
                    let truncated = '';
                    for (const l of lines) {
                      if ((truncated + l + '\n').length > 950) {
                        truncated += `... and ${lines.length - truncated.split('\n').filter(Boolean).length} more`;
                        break;
                      }
                      truncated += l + '\n';
                    }
                    return truncated.trim();
                  };

                  fields.push({
                    name: `🔨 Builder Base Troops (BH${freshPlayer.builderHallLevel}) — ${builderTroops.length} Upgrades Remaining`,
                    value: formatBuilderList(),
                    inline: false,
                  });
                }

                for (const f of fields) {
                  if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
                }

                const totalTroopLevels =
                  (villageFilter === 'builder' ? 0 : homeTroops.reduce((acc, t) => acc + t.levelsRemaining, 0)) +
                  (villageFilter === 'home' ? 0 : builderTroops.reduce((acc, t) => acc + t.levelsRemaining, 0));

                const embed = {
                  title: `⚔️ [${account.name}] Laboratory & Barracks Troop Research`,
                  description: [
                    isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
                    `Troop research remaining to max current levels:`,
                    '',
                    totalTroopLevels === 0
                      ? '🎉 **All troops are currently maxed for your Hall level!**'
                      : `⚡ **Total Outstanding Troop Levels**: **${totalTroopLevels}**`,
                  ].filter(Boolean).join('\n'),
                  color: totalTroopLevels === 0 ? COLORS.GREEN : COLORS.BLUE,
                  fields,
                  thumbnail: { url: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel) },
                  footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus Tracker` },
                  timestamp: new Date().toISOString(),
                };

                await sendAccountMessage(idx, {
                  embeds: [embed],
                  components: [DiscordService.createActionRow([DiscordService.openGameLinkButton('Open CoC')])],
                });
              } catch (accountErr: any) {
                console.error(`Failed to fetch troops for ${account.playerTag}:`, accountErr);
                await sendAccountMessage(idx, {
                  content: `❌ Could not load troop data for **${account.name}** (${account.playerTag}): ${accountErr.message || 'API error'}`,
                });
              }
            }
          } catch (cmdErr: any) {
            console.error('Failed to execute /troops:', cmdErr);
            await editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /roast
      // ----------------------------------------------------------------------
      if (name === 'roast') {
        const targetUserId = optionsMap['user'];
        if (!targetUserId) {
          return respondPersonal({ content: '⚠️ Please mention a user to roast!' });
        }

        // Defer publicly in channel so everyone can enjoy the roast!
        deferReply(false);

        (async () => {
          try {
            const resolvedUser = data.resolved?.users?.[targetUserId];
            const targetUsername = resolvedUser?.global_name || resolvedUser?.username || 'Clasher';
            const targetMention = `<@${targetUserId}>`;

            // Check if the target user has linked Clash of Clans accounts
            const targetUserDoc = await FirestoreService.getUser(targetUserId);
            let roastAccounts: any[] | undefined = undefined;

            if (targetUserDoc?.accounts && targetUserDoc.accounts.length > 0) {
              const warSnap = await FirestoreService.getWarSnapshot(config.coc.clanTag).catch(() => null);

              const fetchPromises = targetUserDoc.accounts.map(async (acc: LinkedAccount) => {
                const baseData: any = {
                  name: acc.name || 'Clasher',
                  tag: acc.playerTag,
                  townHallLevel: acc.townHallLevel || 9,
                  builderHallLevel: acc.builderHallLevel,
                  trophies: 0,
                  warStars: 0,
                  attackWins: 0,
                  defenseWins: 0,
                  donations: 0,
                  donationsReceived: 0,
                  heroes: [],
                };

                try {
                  const fp = await Promise.race([
                    cocService.getPlayer(acc.playerTag),
                    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
                  ]);

                  if (fp) {
                    baseData.name = fp.name;
                    baseData.townHallLevel = fp.townHallLevel;
                    baseData.builderHallLevel = fp.builderHallLevel;
                    baseData.trophies = fp.trophies;
                    baseData.warStars = fp.warStars;
                    baseData.donations = fp.donations;
                    baseData.donationsReceived = fp.donationsReceived;
                    baseData.attackWins = fp.attackWins || 0;
                    baseData.defenseWins = fp.defenseWins || 0;
                    baseData.warPreference = fp.warPreference;
                    baseData.heroes = (fp.heroes || []).map((h: any) => ({ name: h.name, level: h.level }));
                  }
                } catch (e: any) {
                  if (acc.lastSnapshot?.heroes) {
                    baseData.heroes = Object.entries(acc.lastSnapshot.heroes).map(([key, val]: any) => ({
                      name: val.name ?? key.replace(/^(home|builder):/, ''),
                      level: val.level,
                    }));
                  }
                }

                if (warSnap?.postWarAudit) {
                  const missed = warSnap.postWarAudit.zeroAttacks?.find(
                    (m: any) => m.tag.toUpperCase() === acc.playerTag.toUpperCase()
                  );
                  const partial = warSnap.postWarAudit.partialAttacks?.find(
                    (m: any) => m.tag.toUpperCase() === acc.playerTag.toUpperCase()
                  );
                  if (missed) {
                    baseData.warPerformance = 'Missed all attacks in clan war (0 attacks used)';
                  } else if (partial) {
                    baseData.warPerformance = `Only used ${partial.attacksUsed} attack for ${partial.starsGained} stars in clan war`;
                  }
                }

                return baseData;
              });

              roastAccounts = await Promise.all(fetchPromises);
            }

            const roast = await GeminiRoastService.generateRoast({
              discordMention: targetMention,
              discordUsername: targetUsername,
              accounts: roastAccounts,
            });

            // Ensure user mention is present in the text message
            const finalRoastMessage = roast.includes(targetMention)
              ? roast
              : `${targetMention} ${roast}`;

            // Send pure text message with no embed as requested
            await editDeferredReply({
              content: finalRoastMessage,
            });
          } catch (roastErr: any) {
            console.error('[Roast] Error executing roast:', roastErr);
            await editDeferredReply({
              content: `❌ Bimgus got too heated and fumbled the roast: ${roastErr.message || 'Unknown error'}`,
            });
          }
        })();

        return;
      }

      // ----------------------------------------------------------------------
      // COMMAND: /help
      // ----------------------------------------------------------------------
      if (name === 'help') {
        return respondPersonal({
          embeds: [
            {
              title: '🤖 Bimgus — Clash of Clans Discord Assistant',
              description: 'Hi! I am **Bimgus**, your automated Clash of Clans assistant. I track your accounts, keep you ready for Clan Wars, and deliver personalized insights across all your linked accounts!\n\nHere are all available slash commands:',
              fields: [
                {
                  name: '🔥 `/roast [user]`',
                  value: 'Tag another member to let Bimgus deliver a witty, personalized Clash of Clans roast in the channel!\n\u200b',
                  inline: false,
                },
                {
                  name: '🔗 `/link [tag] [dms]`',
                  value: 'Link a Clash of Clans account to your Discord profile. All linked accounts have equal status!\n\u200b',
                  inline: false,
                },
                {
                  name: '🗑️ `/unlink [tag]`',
                  value: 'Unlink an account from your Discord profile.\n\u200b',
                  inline: false,
                },
                {
                  name: '👥 `/accounts`',
                  value: 'View all of your linked Clash of Clans accounts (all accounts have equal status).\n\u200b',
                  inline: false,
                },
                {
                  name: '🔨 `/sixth-builder [account]`',
                  value: 'Check your real-time checklist and progress towards unlocking B.O.B (sends a report for each linked account).\n\u200b',
                  inline: false,
                },
                {
                  name: `${EMOJIS.CROWN} \`/heroes [account] [village]\``,
                  value: 'Check your hero levels against max limits (sends a report for each linked account).\n\u200b',
                  inline: false,
                },
                {
                  name: '🏰 `/upgrades [account]`',
                  value: 'View live progression and all outstanding upgrades (sends a report for each linked account).\n\u200b',
                  inline: false,
                },
                {
                  name: '🛡️ `/defenses [account]`',
                  value: 'Check defense max caps, gear-ups, and Hall upgrade status for your Town Hall / Builder Hall.\n\u200b',
                  inline: false,
                },
                {
                  name: '🧪 `/spells [account]`',
                  value: 'Check spell laboratory research remaining to max your current Town Hall.\n\u200b',
                  inline: false,
                },
                {
                  name: '⚔️ `/troops [account] [village]`',
                  value: 'Check troop research upgrades remaining to max your current Town Hall / Builder Hall.\n\u200b',
                  inline: false,
                },
                {
                  name: '📥 `/import-village [file] [json_text] [account]`',
                  value: 'Import your in-game village JSON export to track exact building levels, timers and costs. One export per account; it includes both villages.\n\u200b',
                  inline: false,
                },
              ],
              color: COLORS.GOLD,
              thumbnail: {
                url: 'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/clashofclans/troops/home/barbarian/barbarian.webp',
              },
              footer: { text: 'Type / in any channel or DM Bimgus directly! • Bimgus' },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      return res.status(400).send('Unknown command');
    } catch (cmdErr: any) {
      console.error(`[Discord Command] Error executing /${name}: ${cmdErr.message}`);
      return respondPersonal({
        content: `❌ An unexpected error occurred while executing \`/${name}\`: ${cmdErr.message}`,
      });
    }
  }

  // 3. Handle Message Components (Button clicks)
  if (type === InteractionType.MESSAGE_COMPONENT) {
    const customId = data.custom_id || '';

    // A. Switch active account (Notice: all accounts equal)
    if (customId.startsWith('switch_account:')) {
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `🌐 All your linked Clash of Clans accounts have equal status! Commands like \`/heroes\`, \`/upgrades\`, and \`/sixth-builder\` automatically send a message for each of your accounts.`,
          flags: 64, // Ephemeral message
        },
      });
    }

    // B. B.O.B Defense Level 9 Toggle
    if (customId.startsWith('bob_defense_done:') || customId.startsWith('bob_defense_undone:')) {
      const [action, tag] = customId.split(':');
      const isDone = action === 'bob_defense_done';
      const success = await FirestoreService.setBobDefenseCompleted(discordUserId, tag, isDone);
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: success
            ? isDone
              ? `✅ Builder Base Defense Lv 9 has been marked as **completed** for \`${tag}\`! Run \`/sixth-builder\` to view your updated progress.`
              : `🔄 Builder Base Defense Lv 9 has been marked as **incomplete** for \`${tag}\`. Run \`/sixth-builder\` to view your updated progress.`
            : `⚠️ Could not find linked account \`${tag}\` under your profile.`,
          flags: 64,
        },
      });
    }

    // B. War Poll Voting
    if (customId.startsWith('war_poll_in:') || customId.startsWith('war_poll_out:')) {
      const [action, pollId] = customId.split(':');
      const isVoteIn = action === 'war_poll_in';

      const poll = await FirestoreService.getWarPoll(pollId);
      if (!poll) {
        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '⚠️ This war poll is no longer active.', flags: 64 },
        });
      }

      const voterUsername = discordUser.username || discordUser.global_name || 'Member';

      // Remove existing votes from this user
      poll.inVotes = (poll.inVotes || []).filter((v: any) => v.userId !== discordUserId);
      poll.outVotes = (poll.outVotes || []).filter((v: any) => v.userId !== discordUserId);

      if (isVoteIn) {
        poll.inVotes.push({ userId: discordUserId, username: voterUsername });
      } else {
        poll.outVotes.push({ userId: discordUserId, username: voterUsername });
      }

      await FirestoreService.saveWarPoll(pollId, poll);

      const inList = poll.inVotes.map((v: any) => `• ${v.username}`).join('\n') || 'None yet';
      const outList = poll.outVotes.map((v: any) => `• ${v.username}`).join('\n') || 'None yet';
      const expiresSec = Math.floor(new Date(poll.expiresAt).getTime() / 1000);

      // Update the message in-place
      return res.json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          embeds: [
            {
              title: `⚔️ ${poll.title}`,
              description: [
                `Are you ready to participate in the upcoming Clan War?`,
                `Please declare your status before <t:${expiresSec}:R>!`,
                '',
                `✅ **I'm In (${poll.inVotes.length})**:`,
                inList,
                '',
                `🛡️ **I'm Out (${poll.outVotes.length})**:`,
                outList,
              ].join('\n'),
              color: COLORS.GOLD,
              footer: { text: `Poll ID: ${pollId} • Bimgus War Coordinator` },
              timestamp: new Date().toISOString(),
            },
          ],
        },
      });
    }

    return res.status(400).send('Unknown component interaction');
  }

  return res.status(400).send('Unknown interaction type');
});
