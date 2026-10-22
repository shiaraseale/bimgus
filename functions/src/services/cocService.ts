import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { ClanResponse, CurrentWarResponse, CapitalRaidResponse } from '../types/coc';

export class CocService {
  private client: AxiosInstance;

  constructor(token?: string, baseUrl?: string) {
    const apiToken = token || config.coc.token;
    const base = baseUrl || config.coc.baseUrl;

    this.client = axios.create({
      baseURL: base,
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
      },
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
