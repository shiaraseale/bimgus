import axios, { AxiosError, AxiosInstance } from 'axios';
import { defineSecret } from 'firebase-functions/params';
import { config } from '../config';
import { ClanResponse, CurrentWarResponse, CapitalRaidResponse, CwlGroupResponse, PlayerResponse } from '../types/coc';
import { log } from '../utils/log';

export const proxyKeySecret = defineSecret('PROXY_KEY');

export function getExpectedProxyKey(): string {
  try {
    return process.env.PROXY_KEY || (proxyKeySecret.value ? proxyKeySecret.value() : '');
  } catch {
    // Secrets can only be read inside Cloud Functions; tests and local scripts use the env var
    return process.env.PROXY_KEY || '';
  }
}

// Rate limits (429) and brief 503s are retried with backoff; maintenance 503s are not
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

function isRetryable(err: AxiosError): boolean {
  const status = err.response?.status;
  if (status === 429) return true;
  if (status === 503) return (err.response?.data as any)?.reason !== 'inMaintenance';
  return false;
}

function retryDelayMs(err: AxiosError, attempt: number): number {
  const retryAfter = Number(err.response?.headers?.['retry-after']);
  const fromHeader = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
  return Math.min(MAX_DELAY_MS, Math.max(fromHeader, BASE_DELAY_MS * 2 ** attempt));
}

let shared: CocService | null = null;

export class CocService {
  private client: AxiosInstance;

  /**
   * One client per container (3.8), created on first use because the proxy key secret is only
   * readable at runtime.
   */
  static shared(): CocService {
    shared ??= new CocService();
    return shared;
  }

  constructor(token?: string, baseUrl?: string, proxyKey?: string) {
    const key = proxyKey !== undefined ? proxyKey : getExpectedProxyKey();
    const base = baseUrl || config.coc.baseUrl;
    const apiToken = token || config.coc.token;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (key) {
      headers['X-Proxy-Key'] = key;
    } else if (apiToken) {
      // Fallback for direct CoC API or during transition before key replacement
      headers['Authorization'] = `Bearer ${apiToken}`;
    }

    this.client = axios.create({
      baseURL: base,
      timeout: 10000,
      headers,
    });

    this.client.interceptors.response.use(undefined, async (err: AxiosError) => {
      const cfg: any = err.config;
      if (!cfg || !isRetryable(err)) throw err;
      cfg.__retryCount = (cfg.__retryCount ?? 0) + 1;
      if (cfg.__retryCount > MAX_RETRIES) throw err;
      const delay = retryDelayMs(err, cfg.__retryCount - 1);
      log.warn(
        `[CocService] ${err.response?.status} on ${cfg.url}; retry ${cfg.__retryCount}/${MAX_RETRIES} in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.client.request(cfg);
    });
  }

  /**
   * Fetches general clan data, including the full member list.
   */
  async getClan(clanTag: string): Promise<ClanResponse> {
    const encoded = config.encodeTag(clanTag);
    const response = await this.client.get<ClanResponse>(`/clans/${encoded}`);
    return response.data;
  }

  /**
   * Fetches the current standard clan war.
   */
  async getCurrentWar(clanTag: string): Promise<CurrentWarResponse> {
    const encoded = config.encodeTag(clanTag);
    const response = await this.client.get<CurrentWarResponse>(`/clans/${encoded}/currentwar`);
    return response.data;
  }

  /**
   * Fetches recent Clan Capital raid weekend seasons.
   */
  async getCapitalRaidSeasons(clanTag: string, limit: number = 2): Promise<CapitalRaidResponse> {
    const encoded = config.encodeTag(clanTag);
    const response = await this.client.get<CapitalRaidResponse>(`/clans/${encoded}/capitalraidseasons?limit=${limit}`);
    return response.data;
  }

  /**
   * Fetches CWL group information.
   */
  async getCwlGroup(clanTag: string): Promise<CwlGroupResponse> {
    const encoded = config.encodeTag(clanTag);
    const response = await this.client.get<CwlGroupResponse>(`/clans/${encoded}/currentwar/leaguegroup`);
    return response.data;
  }

  /**
   * Fetches a specific war from CWL by warTag.
   */
  async getCwlWar(warTag: string): Promise<CurrentWarResponse> {
    const encoded = config.encodeTag(warTag);
    const response = await this.client.get<CurrentWarResponse>(`/clanwarleagues/wars/${encoded}`);
    return response.data;
  }

  /**
   * Fetches a player profile including achievements.
   */
  async getPlayer(playerTag: string): Promise<PlayerResponse> {
    const encoded = config.encodeTag(playerTag);
    const response = await this.client.get<PlayerResponse>(`/players/${encoded}`);
    return response.data;
  }
}
