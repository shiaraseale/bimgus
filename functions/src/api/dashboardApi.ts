import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { defineSecret } from 'firebase-functions/params';
import { FirestoreService } from '../services/firestoreService';
import { CocService } from '../services/cocService';
import { DiscordService, COLORS } from '../services/discordService';
import { runPollClanJob } from '../jobs/pollClanJob';
import { buildCwlSeasonSummary, sendCwlSeasonSummaryDiscord } from '../diff/cwlDiff';
import { sendWarSummaryDiscord } from '../diff/warDiff';
import { findActiveCwlWar } from '../diff/cwlWars';

import { discordInteractionsRouter } from './discordInteractions';
import { registerDiscordCommands } from '../scripts/registerCommands';

export const adminApiKey = defineSecret('ADMIN_API_KEY');

export function getExpectedAdminKey(): string {
  try {
    return process.env.ADMIN_API_KEY || (adminApiKey.value ? adminApiKey.value() : '');
  } catch {
    return process.env.ADMIN_API_KEY || '';
  }
}

export const requireAdminKey: express.RequestHandler = (req, res, next) => {
  const expectedKey = getExpectedAdminKey();
  const providedKey = (req.headers['x-admin-key'] as string) || '';

  if (!expectedKey || !providedKey) {
    res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid X-Admin-Key' });
    return;
  }

  const expectedBuf = Buffer.from(expectedKey);
  const providedBuf = Buffer.from(providedKey);

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    res.status(401).json({ success: false, error: 'Unauthorized: Invalid X-Admin-Key' });
    return;
  }

  next();
  return;
};

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

// Mount Discord Interactions router (handles Discord Slash Commands & Buttons).
// Hosting rewrites /api/** to this function and keeps the path, so everything lives under /api.
dashboardApp.use('/api/discord', discordInteractionsRouter);

const router = express.Router();

dashboardApp.use('/api', router);

// Lightweight warming ping route (returns 204 immediately, no auth or external work)
router.get('/ping', (_req, res) => res.status(204).end());

// The poll saves full responses every 2–4 minutes; older than this, the dashboard goes live instead
const RAW_MAX_AGE_MS = 10 * 60 * 1000;
const isFresh = (raw: { updatedAt: string } | null) => Boolean(raw && Date.now() - new Date(raw.updatedAt).getTime() <= RAW_MAX_AGE_MS);

// Public data changes at most every 2 minutes, so the CDN may cache it briefly (3.6)
const publicCache: express.RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.removeHeader('Pragma');
  res.removeHeader('Expires');
  next();
};

// Public Endpoint: Get clan overview (from the poll's saved copy, or live if that's missing or old)
router.get('/clan/:tag', publicCache, async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const raw = await FirestoreService.getRaw(clanTag, 'clan');
    if (isFresh(raw) && raw?.data) {
      return res.json({ success: true, data: raw.data });
    }
    // Attempt live fetch first for real-time freshness
    try {
      const coc = CocService.shared();
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

// Public Endpoint: Get current war status (regular war first, then the active CWL war)
router.get('/clan/:tag/war', publicCache, async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const raw = await FirestoreService.getRaw(clanTag, 'war');
    if (isFresh(raw) && raw?.data) {
      if (raw.data.state !== 'notInWar') return res.json({ success: true, data: raw.data });
      const cwl = await FirestoreService.getRaw(clanTag, 'cwlWar');
      if (isFresh(cwl) && cwl?.data) return res.json({ success: true, data: cwl.data });
      return res.json({ success: true, data: raw.data });
    }
    const coc = CocService.shared();
    try {
      const liveWar = await coc.getCurrentWar(clanTag);
      if (liveWar.state !== 'notInWar') {
        return res.json({ success: true, data: liveWar });
      }

      // Check if clan is currently in CWL
      try {
        const cwlGroup = await coc.getCwlGroup(clanTag);
        if (cwlGroup && cwlGroup.state !== 'notInWar' && cwlGroup.rounds) {
          const active = await findActiveCwlWar(cwlGroup, clanTag, coc);
          if (active) {
            return res.json({
              success: true,
              data: {
                ...active.war,
                isCwl: true,
                cwlRound: active.roundIndex + 1,
                cwlSeason: cwlGroup.season,
              },
            });
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

// Helper to sanitize config for API responses (returns whether webhook is set, never raw URLs)
function sanitizeConfig(config: any) {
  return {
    ...config,
    webhooks: {
      clanActivity: Boolean(config.webhooks?.clanActivity),
      warRoom: Boolean(config.webhooks?.warRoom),
      cwlHub: Boolean(config.webhooks?.cwlHub),
      raidWeekend: Boolean(config.webhooks?.raidWeekend),
      clanGames: Boolean(config.webhooks?.clanGames),
    },
  };
}

// Co-Leader Endpoint: Get Bot Settings (Requires X-Admin-Key, returns booleans for webhooks)
router.get('/clan/:tag/config', requireAdminKey, async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const config = await FirestoreService.getConfig(clanTag);
    return res.json({ success: true, data: sanitizeConfig(config) });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Update Bot Settings (Requires X-Admin-Key)
router.post('/clan/:tag/config', requireAdminKey, async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const update = req.body || {};

    // Do not overwrite existing webhooks if client sends boolean flags instead of new URL strings
    if (update.webhooks && typeof update.webhooks === 'object') {
      const cleanWebhooks: Record<string, string> = {};
      for (const [k, v] of Object.entries(update.webhooks)) {
        if (typeof v === 'string' && v.trim().length > 0) {
          cleanWebhooks[k] = v.trim();
        }
      }
      if (Object.keys(cleanWebhooks).length > 0) {
        const existing = await FirestoreService.getConfig(clanTag);
        update.webhooks = {
          ...existing.webhooks,
          ...cleanWebhooks,
        };
      } else {
        delete update.webhooks;
      }
    }

    await FirestoreService.updateConfig(clanTag, update);
    const updated = await FirestoreService.getConfig(clanTag);
    return res.json({ success: true, data: sanitizeConfig(updated), message: 'Settings saved successfully' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Trigger on-demand instant poll (Requires X-Admin-Key)
router.post('/clan/:tag/poll', requireAdminKey, async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const result = await runPollClanJob(clanTag);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Co-Leader Endpoint: Test a Discord webhook URL (Requires X-Admin-Key)
router.post('/test-webhook', requireAdminKey, async (req, res) => {
  try {
    const { webhookUrl, channelName, webhookKey, clanTag } = req.body || {};
    let targetUrl = webhookUrl;

    if (!targetUrl && webhookKey && clanTag) {
      const stored = await FirestoreService.getConfig(clanTag);
      targetUrl = (stored.webhooks as any)?.[webhookKey];
    }

    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'Missing webhook URL or webhook not configured yet' });
    }

    const ok = await DiscordService.sendWebhook(targetUrl, {
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
      const coc = CocService.shared();
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

// Co-Leader Endpoint: Force generate & broadcast CWL Season Summary to Discord (Requires X-Admin-Key)
router.post('/clan/:tag/cwl-summary/broadcast', requireAdminKey, async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const coc = CocService.shared();
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

// Co-Leader Endpoint: Force generate & broadcast Regular War Summary to Discord (Requires X-Admin-Key)
router.post('/clan/:tag/war-summary/broadcast', requireAdminKey, async (req, res) => {
  try {
    const clanTag = req.params.tag;
    const coc = CocService.shared();
    const config = await FirestoreService.getConfig(clanTag);
    const webhookUrl = config.webhooks.warRoom;

    if (!webhookUrl) {
      return res.status(400).json({ success: false, error: 'No Discord webhook configured for War Room.' });
    }

    const currentWar = await coc.getCurrentWar(clanTag);
    if (!currentWar || currentWar.state === 'notInWar') {
      return res.status(400).json({ success: false, error: 'Clan is not currently in war.' });
    }

    await sendWarSummaryDiscord(webhookUrl, currentWar);
    return res.json({ success: true, message: 'War summary posted to Discord!' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Admin / Co-Leader Endpoint: Register Slash Commands with Discord API (Requires X-Admin-Key)
router.post('/discord/register-commands', requireAdminKey, async (req, res) => {
  try {
    const { botToken, clientId, guildId } = req.body || {};
    const result = await registerDiscordCommands(botToken, clientId, guildId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message, details: err.response?.data });
  }
});

