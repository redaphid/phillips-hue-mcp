import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { HueClient } from './hue-client.js';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { colord, extend } from 'colord';
import names from 'colord/plugins/names';

// Enable CSS color names support (type assertion needed due to CJS/ESM interop)
extend([names as unknown as Parameters<typeof extend>[0][number]]);

const HUE_BRIDGE_IP = process.env.HUE_BRIDGE_IP || '';
const HUE_USERNAME = process.env.HUE_USERNAME || '';
const PORT = parseInt(process.env.PORT || '3200', 10);

// Convert HSL (0-1) to native Hue format
const toHue = (v?: number) => v != null ? Math.round(v * 65535) : undefined;
const toSat = (v?: number) => v != null ? Math.round(v * 254) : undefined;
const toBri = (v?: number) => v != null ? Math.round(v * 253) + 1 : undefined;

// Parse any CSS color string and convert to Hue bridge native format
// Alpha channel controls brightness: rgba(255,0,0,0.5) = red at 50% brightness
function parseColor(color: string): { hue: number; sat: number; bri: number } | null {
  const c = colord(color);
  if (!c.isValid()) return null;
  const hsl = c.toHsl();
  return {
    hue: Math.round((hsl.h / 360) * 65535),
    sat: Math.round((hsl.s / 100) * 254),
    bri: Math.max(1, Math.round(c.alpha() * 254)),
  };
}

const hueClient = new HueClient(HUE_BRIDGE_IP, HUE_USERNAME);

// Simple https helper
const httpsRequest = (url: string, options: https.RequestOptions = {}, body?: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 10000);
    const req = https.request(url, { ...options, rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { clearTimeout(timeout); resolve(JSON.parse(data)); });
    });
    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    if (body) req.write(body);
    req.end();
  });

const server = new McpServer({
  name: 'philips-hue-mcp',
  version: '1.0.0',
});

// Helper for tool responses
const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const err = (error: any) => ({ content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true });
const json = (data: unknown) => ok(JSON.stringify(data, null, 2));
const notConfigured = () => ok('Not configured. Set HUE_BRIDGE_IP and HUE_USERNAME environment variables, or use discover_bridges and create_auth_token tools.');
const isConfigured = () => HUE_BRIDGE_IP && HUE_USERNAME;

// ============================================
// LIGHT TOOLS
// ============================================

server.registerTool('list_lights', {
  title: 'List Lights',
  description: 'Returns a JSON array of all Philips Hue lights with their IDs, names, and current state (on/off, brightness, color). IMPORTANT: You must call this tool first before using any other light control tools, because you need the light ID numbers from this response. Example response: [{"id": "1", "name": "Living Room", "on": true, "brightness": 254}]',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getLights()); }
  catch (e) { return err(e); }
});

server.registerTool('get_light', {
  title: 'Get Light',
  description: 'Get details of a specific light by its ID',
  inputSchema: z.object({ lightId: z.string().describe('Numeric ID of the light (e.g. "1", "2"). Get IDs from list_lights.') }),
}, async ({ lightId }) => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getLight(lightId)); }
  catch (e) { return err(e); }
});

server.registerTool('turn_light_on', {
  title: 'Turn Light On',
  description: 'Turn on a specific light',
  inputSchema: z.object({ lightId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_lights.') }),
}, async ({ lightId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnLightOn(lightId); return ok(`Light ${lightId} turned on`); }
  catch (e) { return err(e); }
});

server.registerTool('turn_light_off', {
  title: 'Turn Light Off',
  description: 'Turn off a specific light',
  inputSchema: z.object({ lightId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_lights.') }),
}, async ({ lightId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnLightOff(lightId); return ok(`Light ${lightId} turned off`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_brightness', {
  title: 'Set Light Brightness',
  description: `Set the brightness of a specific light without changing its color.

Brightness is a value from 0 to 1, where 0 is minimum brightness and 1 is maximum brightness.

<example>Set light 1 to full brightness: lightId="1", brightness=1</example>
<example>Set light 2 to 50% brightness: lightId="2", brightness=0.5</example>
<example>Set light 3 to dim (25%): lightId="3", brightness=0.25</example>
<example>Set light 1 to very dim (10%): lightId="1", brightness=0.1</example>`,
  inputSchema: z.object({
    lightId: z.string().describe('Required. The numeric light ID as a string. Get IDs by calling list_lights first. <example>"1"</example> <example>"2"</example> <example>"13"</example>'),
    brightness: z.coerce.number().min(0).max(1).describe('Required. Brightness from 0 to 1. <example>1</example> <example>0.5</example> <example>0.25</example> <example>0.1</example>'),
  }),
}, async ({ lightId, brightness }) => {
  if (!isConfigured()) return notConfigured();
  const bri = Math.max(1, Math.round(brightness * 254));
  try { await hueClient.setBrightness(lightId, bri); return ok(`Light ${lightId} brightness set to ${brightness}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_color', {
  title: 'Set Light Color',
  description: `Changes the color of ONE specific light. Use set_all_lights_color instead if you want to change ALL lights.

Accepts any CSS color format. The alpha channel (0-1) controls brightness - use rgba() or hsla() to set both color and brightness at once.

<example>Set light 1 to red at full brightness: lightId="1", color="red"</example>
<example>Set light 2 to blue at full brightness: lightId="2", color="#0000ff"</example>
<example>Set light 1 to green at 50% brightness: lightId="1", color="rgba(0,255,0,0.5)"</example>
<example>Set light 3 to purple at 25% brightness: lightId="3", color="rgba(128,0,128,0.25)"</example>
<example>Set light 1 to warm orange: lightId="1", color="rgb(255,165,0)"</example>
<example>Set light 2 to cyan at 75% brightness: lightId="2", color="hsla(180,100%,50%,0.75)"</example>`,
  inputSchema: z.object({
    lightId: z.string().describe('Required. The numeric light ID as a string. Get IDs by calling list_lights first. <example>"1"</example> <example>"2"</example> <example>"13"</example>'),
    color: z.string().describe('Required. Any CSS color. Use alpha (0-1) to control brightness. <example>"red"</example> <example>"#ff0000"</example> <example>"rgb(255,0,0)"</example> <example>"rgba(255,0,0,0.5)"</example> <example>"hsl(0,100%,50%)"</example> <example>"hsla(240,100%,50%,0.75)"</example>'),
  }),
}, async ({ lightId, color }) => {
  if (!isConfigured()) return notConfigured();
  const native = parseColor(color);
  if (!native) return err({ message: `Invalid color: "${color}". Use CSS colors like "red", "#ff0000", "rgb(255,0,0)", or "hsl(0,100%,50%)"` });
  try {
    await hueClient.setLightState(lightId, { on: true, ...native });
    return ok(`Light ${lightId} set to ${color}`);
  } catch (e) { return err(e); }
});

server.registerTool('set_light_color_temp', {
  title: 'Set Light Color Temperature',
  description: 'Set the color temperature of a specific light (153=cool daylight, 500=warm candlelight)',
  inputSchema: z.object({
    lightId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_lights.'),
    colorTemp: z.coerce.number().min(153).max(500).describe('Color temperature in mireds: 153=cool, 500=warm'),
  }),
}, async ({ lightId, colorTemp }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setColorTemp(lightId, colorTemp); return ok(`Light ${lightId} color temperature set to ${colorTemp} mireds`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_state', {
  title: 'Set Light State',
  description: 'Set multiple properties of a light at once. Use this for advanced control with transitions.',
  inputSchema: z.object({
    lightId: z.string().describe('Required. Light ID like "1" or "2". Get IDs from list_lights.'),
    on: z.boolean().optional().describe('Optional. true=on, false=off'),
    color: z.string().optional().describe('Optional. Any CSS color: "red", "#ff0000", "rgb(255,0,0)", "hsl(0,100%,50%)"'),
    colorTemp: z.coerce.number().min(153).max(500).optional().describe('Optional. Color temperature 153-500. Cool=153, warm=500'),
    transitionTime: z.coerce.number().min(0).optional().describe('Optional. Transition time in 100ms units (10=1sec)'),
  }),
}, async ({ lightId, on, color, colorTemp, transitionTime }) => {
  if (!isConfigured()) return notConfigured();
  try {
    const colorState = color ? parseColor(color) : {};
    if (color && !parseColor(color)) return err({ message: `Invalid color: "${color}"` });
    await hueClient.setLightState(lightId, { on, ...colorState, ct: colorTemp, transitiontime: transitionTime });
    return ok(`Light ${lightId} state updated`);
  } catch (e) { return err(e); }
});

// ============================================
// ROOM TOOLS
// ============================================

server.registerTool('list_rooms', {
  title: 'List Rooms',
  description: 'Get a list of all rooms and zones. Call this first to get room IDs before controlling rooms.',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getRooms()); }
  catch (e) { return err(e); }
});

server.registerTool('list_groups', {
  title: 'List All Groups',
  description: 'Get a list of all groups including rooms, zones, and entertainment areas.',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getAllGroups()); }
  catch (e) { return err(e); }
});

server.registerTool('get_room', {
  title: 'Get Room',
  description: 'Get details of a specific room by its ID',
  inputSchema: z.object({ roomId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_rooms.') }),
}, async ({ roomId }) => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getRoom(roomId)); }
  catch (e) { return err(e); }
});

server.registerTool('turn_room_on', {
  title: 'Turn Room On',
  description: 'Turn on all lights in a room',
  inputSchema: z.object({ roomId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_rooms.') }),
}, async ({ roomId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnRoomOn(roomId); return ok(`Room ${roomId} turned on`); }
  catch (e) { return err(e); }
});

server.registerTool('turn_room_off', {
  title: 'Turn Room Off',
  description: 'Turn off all lights in a room',
  inputSchema: z.object({ roomId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_rooms.') }),
}, async ({ roomId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnRoomOff(roomId); return ok(`Room ${roomId} turned off`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_brightness', {
  title: 'Set Room Brightness',
  description: `Set the brightness of all lights in a room without changing their color.

Brightness is a value from 0 to 1, where 0 is minimum brightness and 1 is maximum brightness.

<example>Set living room to full brightness: roomId="1", brightness=1</example>
<example>Set bedroom to 50% brightness: roomId="2", brightness=0.5</example>
<example>Set office to dim (25%): roomId="3", brightness=0.25</example>
<example>Set kitchen to very dim (10%): roomId="4", brightness=0.1</example>`,
  inputSchema: z.object({
    roomId: z.string().describe('Required. The numeric room ID as a string. Get IDs by calling list_rooms first. <example>"1"</example> <example>"2"</example>'),
    brightness: z.coerce.number().min(0).max(1).describe('Required. Brightness from 0 to 1. <example>1</example> <example>0.5</example> <example>0.25</example> <example>0.1</example>'),
  }),
}, async ({ roomId, brightness }) => {
  if (!isConfigured()) return notConfigured();
  const bri = Math.max(1, Math.round(brightness * 254));
  try { await hueClient.setRoomBrightness(roomId, bri); return ok(`Room ${roomId} brightness set to ${brightness}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_color', {
  title: 'Set Room Color',
  description: `Set the color of ALL lights in a room at once.

Accepts any CSS color format. The alpha channel (0-1) controls brightness - use rgba() or hsla() to set both color and brightness at once.

<example>Set living room to red: roomId="1", color="red"</example>
<example>Set bedroom to blue at 50% brightness: roomId="2", color="rgba(0,0,255,0.5)"</example>
<example>Set office to warm white: roomId="3", color="rgb(255,244,229)"</example>
<example>Set kitchen to green at 75% brightness: roomId="4", color="hsla(120,100%,50%,0.75)"</example>`,
  inputSchema: z.object({
    roomId: z.string().describe('Required. The numeric room ID as a string. Get IDs by calling list_rooms first. <example>"1"</example> <example>"2"</example>'),
    color: z.string().describe('Required. Any CSS color. Use alpha (0-1) to control brightness. <example>"red"</example> <example>"#ff0000"</example> <example>"rgba(255,0,0,0.5)"</example> <example>"hsla(240,100%,50%,0.75)"</example>'),
  }),
}, async ({ roomId, color }) => {
  if (!isConfigured()) return notConfigured();
  const native = parseColor(color);
  if (!native) return err({ message: `Invalid color: "${color}". Use CSS colors like "red", "#ff0000", "rgb(255,0,0)", or "hsl(0,100%,50%)"` });
  try {
    await hueClient.setRoomState(roomId, { on: true, ...native });
    return ok(`Room ${roomId} set to ${color}`);
  } catch (e) { return err(e); }
});

server.registerTool('set_room_color_temp', {
  title: 'Set Room Color Temperature',
  description: 'Set the color temperature of all lights in a room (153=cool daylight, 500=warm candlelight)',
  inputSchema: z.object({
    roomId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_rooms.'),
    colorTemp: z.coerce.number().min(153).max(500).describe('153=cool, 500=warm (mireds)'),
  }),
}, async ({ roomId, colorTemp }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomColorTemp(roomId, colorTemp); return ok(`Room ${roomId} color temperature set to ${colorTemp} mireds`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_state', {
  title: 'Set Room State',
  description: 'Set multiple properties of all lights in a room at once. Use this for advanced control with transitions.',
  inputSchema: z.object({
    roomId: z.string().describe('Required. Room ID like "1" or "2". Get IDs from list_rooms.'),
    on: z.boolean().optional().describe('Optional. true=on, false=off'),
    color: z.string().optional().describe('Optional. Any CSS color: "red", "#ff0000", "rgb(255,0,0)", "hsl(0,100%,50%)"'),
    colorTemp: z.coerce.number().min(153).max(500).optional().describe('Optional. Color temperature 153-500. Cool=153, warm=500'),
    transitionTime: z.coerce.number().min(0).optional().describe('Optional. Transition time in 100ms units (10=1sec)'),
  }),
}, async ({ roomId, on, color, colorTemp, transitionTime }) => {
  if (!isConfigured()) return notConfigured();
  try {
    const colorState = color ? parseColor(color) : {};
    if (color && !parseColor(color)) return err({ message: `Invalid color: "${color}"` });
    await hueClient.setRoomState(roomId, { on, ...colorState, ct: colorTemp, transitiontime: transitionTime });
    return ok(`Room ${roomId} state updated`);
  } catch (e) { return err(e); }
});

// ============================================
// SCENE TOOLS
// ============================================

server.registerTool('list_scenes', {
  title: 'List Scenes',
  description: 'Get a list of all available scenes. Call this first to get scene IDs before activating scenes.',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getScenes()); }
  catch (e) { return err(e); }
});

server.registerTool('activate_scene', {
  title: 'Activate Scene',
  description: 'Activate a specific scene',
  inputSchema: z.object({
    sceneId: z.string().describe('Scene ID (alphanumeric string). Get IDs from list_scenes.'),
    groupId: z.string().optional().describe('Optional group ID to apply scene to. Get IDs from list_groups.'),
  }),
}, async ({ sceneId, groupId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.activateScene(sceneId, groupId); return ok(`Scene ${sceneId} activated${groupId ? ` in group ${groupId}` : ''}`); }
  catch (e) { return err(e); }
});

server.registerTool('delete_scene', {
  title: 'Delete Scene',
  description: 'Permanently delete a scene from the Hue bridge. This action cannot be undone.',
  inputSchema: z.object({
    sceneId: z.string().describe('Scene ID to delete. Get IDs from list_scenes.'),
  }),
}, async ({ sceneId }) => {
  if (!isConfigured()) return notConfigured();
  try {
    await hueClient.deleteScene(sceneId);
    return ok(`Scene ${sceneId} deleted successfully`);
  } catch (e) { return err(e); }
});

server.registerTool('create_scene', {
  title: 'Create Scene',
  description: `Create a new scene that captures the current state of specified lights.

The scene saves the current color, brightness, and on/off state of the lights. You can then activate this scene later to restore those settings.

<example>Create scene from all lights in room 1: name="Movie Night", roomId="1"</example>
<example>Create scene from specific lights: name="Reading", lightIds=["1", "3", "5"]</example>
<example>Create scene from room 2: name="Dinner Party", roomId="2"</example>`,
  inputSchema: z.object({
    name: z.string().describe('Required. Name for the scene. <example>"Movie Night"</example> <example>"Reading"</example> <example>"Party Mode"</example>'),
    roomId: z.string().optional().describe('Create scene from all lights in this room. Get IDs from list_rooms. <example>"1"</example> <example>"2"</example>'),
    lightIds: z.array(z.string()).optional().describe('Create scene from specific lights. Get IDs from list_lights. <example>["1", "2", "3"]</example>'),
  }),
}, async ({ name, roomId, lightIds }) => {
  if (!isConfigured()) return notConfigured();
  try {
    let lights: string[];
    if (lightIds && lightIds.length > 0) {
      lights = lightIds;
    } else if (roomId) {
      const room = await hueClient.getRoom(roomId);
      lights = room.lights;
    } else {
      const allLights = await hueClient.getLights();
      lights = allLights.map(l => l.id);
    }
    const sceneId = await hueClient.createScene(name, lights, roomId);
    return ok(`Scene "${name}" created with ID: ${sceneId}`);
  } catch (e) { return err(e); }
});

// ============================================
// GLOBAL TOOLS
// ============================================

server.registerTool('turn_all_lights_off', {
  title: 'Turn All Lights Off',
  description: 'Turn off all lights in the house',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomState('0', { on: false }); return ok('All lights turned off'); }
  catch (e) { return err(e); }
});

server.registerTool('turn_all_lights_on', {
  title: 'Turn All Lights On',
  description: 'Turn on all lights in the house',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomState('0', { on: true }); return ok('All lights turned on'); }
  catch (e) { return err(e); }
});

server.registerTool('set_all_lights_color', {
  title: 'Set All Lights Color',
  description: `Set the color of ALL lights in the entire house at once. This is the easiest way to change all lights to one color.

Accepts any CSS color format. The alpha channel (0-1) controls brightness - use rgba() or hsla() to set both color and brightness at once.

<example>Set all lights to red: color="red"</example>
<example>Set all lights to blue at full brightness: color="#0000ff"</example>
<example>Set all lights to green at 50% brightness: color="rgba(0,255,0,0.5)"</example>
<example>Set all lights to purple at 25% brightness: color="rgba(128,0,128,0.25)"</example>
<example>Set all lights to warm orange: color="rgb(255,165,0)"</example>
<example>Set all lights to cyan at 75% brightness: color="hsla(180,100%,50%,0.75)"</example>
<example>Set all lights to pink: color="pink"</example>
<example>Set all lights to dim red for movie night: color="rgba(255,0,0,0.2)"</example>`,
  inputSchema: z.object({
    color: z.string().describe('Required. Any CSS color. Use alpha (0-1) to control brightness. <example>"red"</example> <example>"blue"</example> <example>"#ff0000"</example> <example>"rgba(255,0,0,0.5)"</example> <example>"hsla(240,100%,50%,0.75)"</example> <example>"pink"</example> <example>"coral"</example>'),
  }),
}, async ({ color }) => {
  if (!isConfigured()) return notConfigured();
  const native = parseColor(color);
  if (!native) return err({ message: `Invalid color: "${color}". Use CSS colors like "red", "#ff0000", "rgb(255,0,0)", or "hsl(0,100%,50%)"` });
  try {
    await hueClient.setRoomState('0', { on: true, ...native });
    return ok(`All lights set to ${color}`);
  } catch (e) { return err(e); }
});

// ============================================
// SETUP & AUTHENTICATION TOOLS
// ============================================

server.registerTool('discover_bridges', {
  title: 'Discover Bridges',
  description: 'Discover Philips Hue bridges on your local network using the Hue discovery service',
}, async () => {
  try {
    const bridges = await httpsRequest('https://discovery.meethue.com/');
    if (!bridges || bridges.length === 0) {
      return ok('No Hue bridges found on the network. Make sure your bridge is powered on and connected to the same network.');
    }
    return ok(`Found ${bridges.length} Hue bridge(s):\n\n${JSON.stringify(bridges, null, 2)}\n\nUse the bridge IP address with the create_auth_token tool to authenticate.`);
  } catch (e) { return err(e); }
});

server.registerTool('create_auth_token', {
  title: 'Create Auth Token',
  description: 'Create a new auth token for the Hue bridge. IMPORTANT: You must press the button on the Hue bridge first, then call this within 30 seconds!',
  inputSchema: z.object({
    bridgeIp: z.string().describe('The IP address of the Hue bridge'),
    appName: z.string().optional().describe('Application name (default: philips-hue-mcp)'),
    deviceName: z.string().optional().describe('Device name (default: claude-agent)'),
  }),
}, async ({ bridgeIp, appName = 'philips-hue-mcp', deviceName = 'claude-agent' }) => {
  try {
    const body = JSON.stringify({ devicetype: `${appName}#${deviceName}` });
    const result = await httpsRequest(`https://${bridgeIp}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, body);

    if (Array.isArray(result) && result[0]?.error) {
      const error = result[0].error;
      if (error.type === 101) {
        return ok(`Link button not pressed!\n\nPlease:\n1. Press the button on top of your Hue bridge\n2. Run this tool again within 30 seconds`);
      }
      return err({ message: error.description });
    }

    if (Array.isArray(result) && result[0]?.success?.username) {
      const username = result[0].success.username;
      return ok(`Auth token created successfully!\n\nYour new auth token: ${username}\n\nSet these environment variables:\n  HUE_BRIDGE_IP=${bridgeIp}\n  HUE_USERNAME=${username}`);
    }

    return err({ message: `Unexpected response: ${JSON.stringify(result)}` });
  } catch (e) { return err(e); }
});

server.registerTool('test_connection', {
  title: 'Test Connection',
  description: 'Test the connection to the Hue bridge with current credentials',
}, async () => {
  if (!HUE_BRIDGE_IP || !HUE_USERNAME) {
    return ok(`Not configured!\n\nMissing environment variables:\n${!HUE_BRIDGE_IP ? '- HUE_BRIDGE_IP\n' : ''}${!HUE_USERNAME ? '- HUE_USERNAME\n' : ''}\nUse discover_bridges and create_auth_token to set up.`);
  }
  try {
    const lights = await hueClient.getLights();
    return ok(`Connection successful!\n\nBridge IP: ${HUE_BRIDGE_IP}\nFound ${lights.length} lights.`);
  } catch (e) { return err(e); }
});

// ============================================
// SERVER
// ============================================

const transports: Record<string, StreamableHTTPServerTransport> = {};

async function main() {
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID' }, id: null });
      }
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) return res.status(400).send('Invalid or missing session ID');
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) return res.status(400).send('Invalid or missing session ID');
    await transports[sessionId].handleRequest(req, res);
  });

  app.listen(PORT, () => {
    console.log(`Philips Hue MCP server running on http://0.0.0.0:${PORT}/mcp`);
  });
}

main().catch(console.error);
