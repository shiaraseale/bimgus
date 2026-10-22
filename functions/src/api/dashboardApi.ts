import express from 'express';
import cors from 'cors';
import { FirestoreService } from '../services/firestoreService';
import { CocService } from '../services/cocService';
import { DiscordService, COLORS } from '../services/discordService';
import { runPollClanJob } from '../jobs/pollClanJob';
import { buildCwlSeasonSummary, sendCwlSeasonSummaryDiscord } from '../diff/cwlDiff';

import { discordInteractionsRouter } from './discordInteractions';
import { registerDiscordCommands } from '../scripts/registerCommands';

export const dashboardApp = express();
dashboardApp.use(cors({ origin: true }));
dashboardApp.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Prevent Google Cloud CDN / Firebase Hosting from caching dynamic API responses
dashboardApp.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Mount Discord Interactions router (handles Discord Slash Commands & Buttons)
dashboardApp.use('/api/discord', discordInteractionsRouter);
dashboardApp.use('/discord', discordInteractionsRouter);

const router = express.Router();

dashboardApp.use('/api', router);
dashboardApp.use('/', router);

// Public Endpoint: Get clan overview and live snapshot
router.get('/clan/:tag', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    // Attempt live fetch first for real-time freshness
    try {
      const coc = new CocService();
      const liveClan = await coc.getClan(clanTag);
      return res.json({ success: true, data: liveClan });
    } catch (apiErr) {
      // Fallback to Firestore snapshot if direct CoC API is unreachable
      const snapshot = await FirestoreService.getClanSnapshot(clanTag);
      if (snapshot) {
        return res.json({ success: true, data: snapshot });
      }
      throw apiErr;
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Public Endpoint: Get current war status
router.get('/clan/:tag/war', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const coc = new CocService();
    try {
      const liveWar = await coc.getCurrentWar(clanTag);
      if (liveWar.state !== 'notInWar') {
        return res.json({ success: true, data: liveWar });
      }

      // Check if clan is currently in CWL
      try {
        const cwlGroup = await coc.getCwlGroup(clanTag);
        if (cwlGroup && cwlGroup.state !== 'notInWar' && cwlGroup.rounds) {
          for (let r = 0; r < cwlGroup.rounds.length; r++) {
            const validTags = (cwlGroup.rounds[r].warTags || []).filter((t: string) => t && t !== '#0');
            for (const wt of validTags) {
              const cwlWar = await coc.getCwlWar(wt);
              const isOurWar =
                cwlWar.clan.tag.toUpperCase() === clanTag.toUpperCase() ||
                cwlWar.opponent.tag.toUpperCase() === clanTag.toUpperCase();

              if (isOurWar && (cwlWar.state === 'inWar' || cwlWar.state === 'preparation')) {
                return res.json({
                  success: true,
                  data: {
                    ...cwlWar,
                    isCwl: true,
                    cwlRound: r + 1,
                    cwlSeason: cwlGroup.season,
                  },
                });
              }
            }
          }
        }
      } catch {
        // Not in CWL
      }

      return res.json({ success: true, data: liveWar });
    } catch (err: any) {
      // If war log is private or access is restricted, Supercell returns 403
      if (err.response?.status === 403) {
        const snapshot = await FirestoreService.getWarSnapshot(clanTag);
        if (snapshot) {
          return res.json({ success: true, data: snapshot });
        }
        return res.json({
          success: true,
          data: {
            state: 'notInWar',
            isWarLogPrivate: true,
            message: 'War log is private or clan is not currently in an active war.',
          },
        });
      }
      throw err;
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Get Bot Settings
router.get('/clan/:tag/config', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const config = await FirestoreService.getConfig(clanTag);
    return res.json({ success: true, data: config });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Update Bot Settings
router.post('/clan/:tag/config', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const update = req.body;
    await FirestoreService.updateConfig(clanTag, update);
    const updated = await FirestoreService.getConfig(clanTag);
    return res.json({ success: true, data: updated, message: 'Settings saved successfully' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Trigger on-demand instant poll
router.post('/clan/:tag/poll', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const result = await runPollClanJob(clanTag);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Test a Discord webhook URL
router.post('/test-webhook', async (req, res) => {
  try {
    const { webhookUrl, channelName } = req.body;
    if (!webhookUrl) {
      return res.status(400).json({ success: false, error: 'Missing webhookUrl' });
    }

    const ok = await DiscordService.sendWebhook(webhookUrl, {
      embeds: [
        {
          title: '✅ Webhook Test Successful',
          description: `This channel is successfully configured for **${channelName || 'Clash Alerts'}**!`,
          color: COLORS.GREEN,
          fields: [
            { name: 'Status', value: 'Ready for live streaming', inline: true },
            { name: 'Source', value: 'Bimgus', inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });

    if (ok) {
      return res.json({ success: true, message: 'Test message sent to Discord!' });
    } else {
      return res.status(400).json({ success: false, error: 'Discord rejected the webhook request' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Diagnostic Endpoint: Get raw CWL snapshot from Firestore
router.get('/clan/:tag/cwl-snapshot', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const snapshot = await FirestoreService.getCwlSnapshot(clanTag);
    return res.json({ success: true, data: snapshot });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Public Endpoint: Get CWL Season Summary
router.get('/clan/:tag/cwl-summary', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const snapshot = await FirestoreService.getCwlSnapshot(clanTag);
    if (snapshot?.seasonSummary) {
      return res.json({ success: true, data: snapshot.seasonSummary });
    }

    // Attempt calculation: try live CWL group, or fall back to stored round war tags
    try {
      const coc = new CocService();
      let summary: any = null;
      try {
        const cwlGroup = await coc.getCwlGroup(clanTag);
        if (cwlGroup && cwlGroup.state !== 'notInWar') {
          summary = await buildCwlSeasonSummary(cwlGroup, clanTag, coc);
        }
      } catch {
        // League group expired, rebuild from stored round war tags
        if (snapshot?.loggedAttackOrders) {
          const warTags = Object.keys(snapshot.loggedAttackOrders);
          if (warTags.length > 0) {
            const rounds = warTags.map((wt) => ({ warTags: [wt] }));
            summary = await buildCwlSeasonSummary(
              { state: 'ended', season: snapshot.season || '2026-10-01', clans: snapshot.clans || [], rounds } as any,
              clanTag,
              coc
            );
          }
        }
      }

      if (summary) {
        if (snapshot) {
          await FirestoreService.saveCwlSnapshot(clanTag, {
            ...snapshot,
            seasonSummary: summary,
          });
        }
        return res.json({ success: true, data: summary });
      }
    } catch {
      // League group expired or not found
    }

    return res.status(404).json({ success: false, message: 'No CWL season summary available yet.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Force generate & broadcast CWL Season Summary to Discord
router.post('/clan/:tag/cwl-summary/broadcast', async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const coc = new CocService();
    const config = await FirestoreService.getConfig(clanTag);
    const webhookUrl = config.webhooks.cwlHub || config.webhooks.warRoom;

    if (!webhookUrl) {
      return res.status(400).json({ success: false, error: 'No Discord webhook configured for CWL Hub or War Room.' });
    }

    const prevSnapshot = await FirestoreService.getCwlSnapshot(clanTag);
    let summary: any = null;

    try {
      const cwlGroup = await coc.getCwlGroup(clanTag);
      summary = await buildCwlSeasonSummary(cwlGroup, clanTag, coc);
    } catch {
      // League group expired, rebuild from stored war tags
      if (prevSnapshot?.loggedAttackOrders) {
        const warTags = Object.keys(prevSnapshot.loggedAttackOrders);
        if (warTags.length > 0) {
          const rounds = warTags.map((wt) => ({ warTags: [wt] }));
          summary = await buildCwlSeasonSummary(
            { state: 'ended', season: prevSnapshot.season || '2026-10-01', clans: prevSnapshot.clans || [], rounds } as any,
            clanTag,
            coc
          );
        }
      }
    }

    if (!summary) {
      return res.status(400).json({ success: false, error: 'Unable to build CWL summary (no completed rounds found).' });
    }

    await sendCwlSeasonSummaryDiscord(summary, webhookUrl);

    if (prevSnapshot) {
      await FirestoreService.saveCwlSnapshot(clanTag, {
        ...prevSnapshot,
        announcedSeasonSummary: true,
        seasonSummary: summary,
      });
    }

    return res.json({ success: true, message: 'CWL Season Summary posted to Discord!', data: summary });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Admin / Co-Leader Endpoint: Register Slash Commands with Discord API
router.post('/discord/register-commands', async (req, res) => {
  try {
    const { botToken, clientId, guildId } = req.body || {};
    const result = await registerDiscordCommands(botToken, clientId, guildId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message, details: err.response?.data });
  }
});

