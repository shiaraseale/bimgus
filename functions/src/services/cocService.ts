import axios, { AxiosInstance } from 'axios';
import { defineSecret } from 'firebase-functions/params';
import { config } from '../config';
import { ClanResponse, CurrentWarResponse, CapitalRaidResponse } from '../types/coc';

export const proxyKeySecret = defineSecret('PROXY_KEY');

export function getExpectedProxyKey(): string {
  try {
    return process.env.PROXY_KEY || (proxyKeySecret.value ? proxyKeySecret.value() : '');
  } catch {
    return process.env.PROXY_KEY || '';
  }
}

export class CocService {
  private client: AxiosInstance;

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
  async getCwlGroup(clanTag: string): Promise<any> {
    const encoded = config.encodeTag(clanTag);
    const response = await this.client.get(`/clans/${encoded}/currentwar/leaguegroup`);
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
  async getPlayer(playerTag: string): Promise<any> {
    const encoded = config.encodeTag(playerTag);
    const response = await this.client.get(`/players/${encoded}`);
    return response.data;
  }
}
