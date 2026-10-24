import axios from 'axios';
import { config } from './config';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { runPollClanJob } from './jobs/pollClanJob';
import { dashboardApp, adminApiKey } from './api/dashboardApi';
import { runCommandTask } from './api/discord/router';
import { proxyKeySecret } from './services/cocService';
import { RoastTaskData, runRoastTask } from './jobs/roastJob';
import { ImportTaskData, runImportTask } from './jobs/importJob';
import { log } from './utils/log';

/**
 * Scheduled Cloud Function (2nd Gen): the only scheduled job (3.1). Every 2 minutes it polls the clan
 * and decides per tick what else to run, including the war reminders that used to be a separate
 * 30-minute job, so only one Cloud Scheduler job is used per environment (D10).
 */
export const pollClanScheduled = onSchedule(
  {
    schedule: 'every 2 minutes',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 120,
    secrets: [proxyKeySecret],
  },
  async (event) => {
    log.info('[Schedule] Running pollClanScheduled...');

    // Fire API warming ping if configured, without blocking the poll job
    const pingUrl = config.apiPingUrl;
    const pingPromise = pingUrl
      ? axios.get(pingUrl, { timeout: 5000 }).catch((err: any) => {
          log.warn(`[Ping] Warning: warming ping failed (${err.message})`);
        })
      : null;

    const scheduleTime = event.scheduleTime ? new Date(event.scheduleTime) : new Date();
    const result = await runPollClanJob(undefined, { scheduleTime });
    log.info('[Schedule] Result:', result);

    if (pingPromise) {
      await pingPromise;
    }
  }
);

/**
 * HTTPS Function (2nd Gen):
 * Serves the REST API for the public & co-leader dashboard.
 */
export const api = onRequest(
  {
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 60,
    secrets: [adminApiKey, proxyKeySecret],
  },
  dashboardApp
);

/**
 * Cloud Task (2nd Gen): writes a /roast queued by the interaction handler and edits its reply.
 * Runs with full CPU, unlike work done after the interaction's HTTP response (2.7).
 */
export const roastTask = onTaskDispatched<RoastTaskData>(
  {
    retryConfig: { maxAttempts: 1 },
    rateLimits: { maxConcurrentDispatches: 5 },
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: [proxyKeySecret],
  },
  async (req) => {
    await runRoastTask(req.data);
  }
);

/**
 * Cloud Task (2nd Gen): runs a /import-village queued by the interaction handler (3.7).
 */
export const importTask = onTaskDispatched<ImportTaskData>(
  {
    retryConfig: { maxAttempts: 1 },
    rateLimits: { maxConcurrentDispatches: 5 },
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req) => {
    await runImportTask(req.data);
  }
);

/**
 * Cloud Task (2nd Gen): replays a slow slash command (/upgrades, /defenses, /heroes, …) queued by the
 * interaction handler, so its work runs with full CPU (3.7).
 */
export const commandTask = onTaskDispatched<{ interaction: any }>(
  {
    retryConfig: { maxAttempts: 1 },
    rateLimits: { maxConcurrentDispatches: 10 },
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: [proxyKeySecret],
  },
  async (req) => {
    await runCommandTask(req.data.interaction);
  }
);
