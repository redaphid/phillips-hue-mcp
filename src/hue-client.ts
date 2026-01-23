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
  private baseUrl: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(bridgeIp: string, username: string) {
    this.baseUrl = `/api/${username}`;
    this.agent = new https.Agent({ rejectUnauthorized: false });
    this.bridgeIp = bridgeIp;
  }

  private agent: https.Agent;
  private bridgeIp: string;

  private async request(method: string, path: string, body?: object): Promise<any> {
    const attempt = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 10000);
      const req = https.request({
        hostname: this.bridgeIp,
        path: this.baseUrl + path,
        method,
        agent: this.agent,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { clearTimeout(timeout); resolve(JSON.parse(data)); });
      });
      req.on('error', (e) => { clearTimeout(timeout); reject(e); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });

    const fn = async () => {
      for (let i = 0; i < 3; i++) {
        try { return await attempt(); }
        catch (e) { if (i === 2) throw e; }
      }
    };

    return this.pending = this.pending.then(fn, fn);
  }

  private get(path: string) { return this.request('GET', path); }
  private put(path: string, body: object) { return this.request('PUT', path, body); }
  private post(path: string, body: object) { return this.request('POST', path, body); }

  async getLights(): Promise<HueLight[]> {
    const data = await this.get('/lights');
    return Object.entries(data).map(([id, d]: [string, any]) => ({
      id, name: d.name, type: d.type, on: d.state.on, brightness: d.state.bri,
      colorMode: d.state.colormode, hue: d.state.hue, saturation: d.state.sat,
      colorTemp: d.state.ct, reachable: d.state.reachable,
    }));
  }

  async getLight(id: string): Promise<HueLight> {
    const d = await this.get(`/lights/${id}`);
    return {
      id, name: d.name, type: d.type, on: d.state.on, brightness: d.state.bri,
      colorMode: d.state.colormode, hue: d.state.hue, saturation: d.state.sat,
      colorTemp: d.state.ct, reachable: d.state.reachable,
    };
  }

  setLightState(id: string, state: object) { return this.put(`/lights/${id}/state`, state); }
  turnLightOn(id: string) { return this.setLightState(id, { on: true }); }
  turnLightOff(id: string) { return this.setLightState(id, { on: false }); }
  setBrightness(id: string, bri: number) { return this.setLightState(id, { on: true, bri: Math.min(254, Math.max(1, bri)) }); }
  setColor(id: string, hue: number, sat: number, bri: number) { return this.setLightState(id, { on: true, hue, sat, bri }); }
  setColorTemp(id: string, ct: number) { return this.setLightState(id, { on: true, ct: Math.min(500, Math.max(153, ct)) }); }

  async getRooms(): Promise<HueRoom[]> {
    const data = await this.get('/groups');
    return Object.entries(data)
      .filter(([, d]: [string, any]) => d.type === 'Room' || d.type === 'Zone')
      .map(([id, d]: [string, any]) => ({
        id, name: d.name, type: d.type, lights: d.lights,
        on: d.action?.on ?? false, brightness: d.action?.bri ?? 0,
      }));
  }

  async getRoom(id: string): Promise<HueRoom> {
    const d = await this.get(`/groups/${id}`);
    return {
      id, name: d.name, type: d.type, lights: d.lights,
      on: d.action?.on ?? false, brightness: d.action?.bri ?? 0,
    };
  }

  setRoomState(id: string, state: object) { return this.put(`/groups/${id}/action`, state); }
  turnRoomOn(id: string) { return this.setRoomState(id, { on: true }); }
  turnRoomOff(id: string) { return this.setRoomState(id, { on: false }); }
  setRoomBrightness(id: string, bri: number) { return this.setRoomState(id, { on: true, bri: Math.min(254, Math.max(1, bri)) }); }
  setRoomColor(id: string, hue: number, sat: number, bri: number) { return this.setRoomState(id, { on: true, hue, sat, bri }); }
  setRoomColorTemp(id: string, ct: number) { return this.setRoomState(id, { on: true, ct: Math.min(500, Math.max(153, ct)) }); }

  async getScenes(): Promise<HueScene[]> {
    const data = await this.get('/scenes');
    return Object.entries(data).map(([id, d]: [string, any]) => ({
      id, name: d.name, group: d.group, type: d.type,
    }));
  }

  async activateScene(sceneId: string, groupId?: string): Promise<void> {
    if (groupId) {
      await this.put(`/groups/${groupId}/action`, { scene: sceneId });
    } else {
      const scenes = await this.getScenes();
      const scene = scenes.find(s => s.id === sceneId);
      await this.put(`/groups/${scene?.group || '0'}/action`, { scene: sceneId });
    }
  }

  async createScene(name: string, lights: string[], groupId?: string): Promise<string> {
    const result = await this.post('/scenes', {
      name,
      lights,
      group: groupId,
      recycle: false,
      type: 'LightScene',
    });
    if (Array.isArray(result) && result[0]?.success?.id) return result[0].success.id;
    throw new Error(result[0]?.error?.description || 'Failed to create scene');
  }

  async getAllGroups(): Promise<HueRoom[]> {
    const data = await this.get('/groups');
    return Object.entries(data).map(([id, d]: [string, any]) => ({
      id, name: d.name, type: d.type, lights: d.lights,
      on: d.action?.on ?? false, brightness: d.action?.bri ?? 0,
    }));
  }
}
