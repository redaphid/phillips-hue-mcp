import axios, { type AxiosInstance } from 'axios';
import https from 'node:https';

export interface HueLight {
  id: string;
  name: string;
  type: string;
  on: boolean;
  brightness: number;
  colorMode?: string;
  hue?: number;
  saturation?: number;
  colorTemp?: number;
  reachable: boolean;
}

export interface HueRoom {
  id: string;
  name: string;
  type: string;
  lights: string[];
  on: boolean;
  brightness: number;
}

export interface HueScene {
  id: string;
  name: string;
  group?: string;
  type: string;
}

export class HueClient {
  private api: AxiosInstance;
  private bridgeIp: string;
  private username: string;

  constructor(bridgeIp: string, username: string) {
    this.bridgeIp = bridgeIp;
    this.username = username;

    this.api = axios.create({
      baseURL: `https://${bridgeIp}/api/${username}`,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 10000,
    });
  }

  async getLights(): Promise<HueLight[]> {
    const response = await this.api.get('/lights');
    const lights: HueLight[] = [];

    for (const [id, data] of Object.entries(response.data)) {
      const light = data as any;
      lights.push({
        id,
        name: light.name,
        type: light.type,
        on: light.state.on,
        brightness: light.state.bri,
        colorMode: light.state.colormode,
        hue: light.state.hue,
        saturation: light.state.sat,
        colorTemp: light.state.ct,
        reachable: light.state.reachable,
      });
    }

    return lights;
  }

  async getLight(lightId: string): Promise<HueLight> {
    const response = await this.api.get(`/lights/${lightId}`);
    const light = response.data;

    return {
      id: lightId,
      name: light.name,
      type: light.type,
      on: light.state.on,
      brightness: light.state.bri,
      colorMode: light.state.colormode,
      hue: light.state.hue,
      saturation: light.state.sat,
      colorTemp: light.state.ct,
      reachable: light.state.reachable,
    };
  }

  async setLightState(lightId: string, state: {
    on?: boolean;
    bri?: number;
    hue?: number;
    sat?: number;
    ct?: number;
    transitiontime?: number;
  }): Promise<void> {
    await this.api.put(`/lights/${lightId}/state`, state);
  }

  async turnLightOn(lightId: string): Promise<void> {
    await this.setLightState(lightId, { on: true });
  }

  async turnLightOff(lightId: string): Promise<void> {
    await this.setLightState(lightId, { on: false });
  }

  async setBrightness(lightId: string, brightness: number): Promise<void> {
    const bri = Math.max(1, Math.min(254, brightness));
    await this.setLightState(lightId, { on: true, bri });
  }

  async setColor(lightId: string, hue: number, saturation: number): Promise<void> {
    const h = Math.max(0, Math.min(65535, hue));
    const s = Math.max(0, Math.min(254, saturation));
    await this.setLightState(lightId, { on: true, hue: h, sat: s });
  }

  async setColorTemp(lightId: string, colorTemp: number): Promise<void> {
    const ct = Math.max(153, Math.min(500, colorTemp));
    await this.setLightState(lightId, { on: true, ct });
  }

  async getRooms(): Promise<HueRoom[]> {
    const response = await this.api.get('/groups');
    const rooms: HueRoom[] = [];

    for (const [id, data] of Object.entries(response.data)) {
      const group = data as any;
      if (group.type === 'Room' || group.type === 'Zone') {
        rooms.push({
          id,
          name: group.name,
          type: group.type,
          lights: group.lights,
          on: group.action?.on ?? false,
          brightness: group.action?.bri ?? 0,
        });
      }
    }

    return rooms;
  }

  async getRoom(roomId: string): Promise<HueRoom> {
    const response = await this.api.get(`/groups/${roomId}`);
    const group = response.data;

    return {
      id: roomId,
      name: group.name,
      type: group.type,
      lights: group.lights,
      on: group.action?.on ?? false,
      brightness: group.action?.bri ?? 0,
    };
  }

  async setRoomState(roomId: string, state: {
    on?: boolean;
    bri?: number;
    hue?: number;
    sat?: number;
    ct?: number;
    transitiontime?: number;
  }): Promise<void> {
    await this.api.put(`/groups/${roomId}/action`, state);
  }

  async turnRoomOn(roomId: string): Promise<void> {
    await this.setRoomState(roomId, { on: true });
  }

  async turnRoomOff(roomId: string): Promise<void> {
    await this.setRoomState(roomId, { on: false });
  }

  async setRoomBrightness(roomId: string, brightness: number): Promise<void> {
    const bri = Math.max(1, Math.min(254, brightness));
    await this.setRoomState(roomId, { on: true, bri });
  }

  async setRoomColor(roomId: string, hue: number, saturation: number): Promise<void> {
    const h = Math.max(0, Math.min(65535, hue));
    const s = Math.max(0, Math.min(254, saturation));
    await this.setRoomState(roomId, { on: true, hue: h, sat: s });
  }

  async setRoomColorTemp(roomId: string, colorTemp: number): Promise<void> {
    const ct = Math.max(153, Math.min(500, colorTemp));
    await this.setRoomState(roomId, { on: true, ct });
  }

  async getScenes(): Promise<HueScene[]> {
    const response = await this.api.get('/scenes');
    const scenes: HueScene[] = [];

    for (const [id, data] of Object.entries(response.data)) {
      const scene = data as any;
      scenes.push({
        id,
        name: scene.name,
        group: scene.group,
        type: scene.type,
      });
    }

    return scenes;
  }

  async activateScene(sceneId: string, groupId?: string): Promise<void> {
    if (groupId) {
      await this.api.put(`/groups/${groupId}/action`, { scene: sceneId });
    } else {
      const scenes = await this.getScenes();
      const scene = scenes.find(s => s.id === sceneId);
      if (scene?.group) {
        await this.api.put(`/groups/${scene.group}/action`, { scene: sceneId });
      } else {
        await this.api.put('/groups/0/action', { scene: sceneId });
      }
    }
  }

  async getAllGroups(): Promise<any[]> {
    const response = await this.api.get('/groups');
    const groups: any[] = [];

    for (const [id, data] of Object.entries(response.data)) {
      const group = data as any;
      groups.push({
        id,
        name: group.name,
        type: group.type,
        lights: group.lights,
        on: group.action?.on ?? false,
        brightness: group.action?.bri ?? 0,
      });
    }

    return groups;
  }
}
