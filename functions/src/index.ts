import axios from 'axios';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runPollClanJob } from './jobs/pollClanJob';
import { runWarPingJob } from './jobs/warPingJob';
import { dashboardApp, adminApiKey } from './api/dashboardApi';

/**
 * Scheduled Cloud Function (2nd Gen):
 * Runs every 2 minutes to poll Clash of Clans and stream diffs to Discord.
 */
export const pollClanScheduled = onSchedule(
  {
    schedule: 'every 2 minutes',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    console.log('[Schedule] Running pollClanScheduled...');

    // Fire API warming ping if configured, without blocking the poll job
    const pingUrl = process.env.API_PING_URL;
    const pingPromise = pingUrl
      ? axios.get(pingUrl, { timeout: 5000 }).catch((err: any) => {
          console.warn(`[Ping] Warning: warming ping failed (${err.message})`);
        })
      : null;

    const result = await runPollClanJob();
    console.log('[Schedule] Result:', result);

    if (pingPromise) {
      await pingPromise;
    }
  }
);

/**
 * Scheduled Cloud Function (2nd Gen):
 * Runs every 30 minutes to check if war attacks are pending with <4h remaining.
 */
export const warReminderScheduled = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    console.log('[Schedule] Running warReminderScheduled...');
    const result = await runWarPingJob();
    console.log('[Schedule] Result:', result);
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
    secrets: [adminApiKey],
  },
  dashboardApp
);
