import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { HueClient } from './hue-client.js';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import https from 'node:https';

const HUE_BRIDGE_IP = process.env.HUE_BRIDGE_IP || '';
const HUE_USERNAME = process.env.HUE_USERNAME || '';
const PORT = parseInt(process.env.PORT || '3100', 10);

// Convert HSL (0-1) to native Hue format
const toHue = (v?: number) => v != null ? Math.round(v * 65535) : undefined;
const toSat = (v?: number) => v != null ? Math.round(v * 254) : undefined;
const toBri = (v?: number) => v != null ? Math.round(v * 253) + 1 : undefined;

const hueClient = new HueClient(HUE_BRIDGE_IP, HUE_USERNAME);
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
  description: 'Get a list of all Philips Hue lights with their current state. Call this first to get light IDs before controlling lights.',
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
  description: 'Set the brightness of a specific light (1-254)',
  inputSchema: z.object({
    lightId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_lights.'),
    brightness: z.coerce.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ lightId, brightness }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setBrightness(lightId, brightness); return ok(`Light ${lightId} brightness set to ${brightness}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_color', {
  title: 'Set Light Color',
  description: 'Set the color of a light. Example: red at full brightness = hue:0, saturation:1, lightness:1',
  inputSchema: z.object({
    lightId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_lights.'),
    hue: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=red, 0.33=green, 0.66=blue'),
    saturation: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=white, 1=vivid color'),
    lightness: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=off, 0.5=medium, 1=bright'),
  }),
}, async ({ lightId, hue, saturation, lightness }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setColor(lightId, hue, saturation, lightness); return ok(`Light ${lightId} color set`); }
  catch (e) { return err(e); }
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
  description: 'Set multiple properties of a light. HSL values must be 0 to 1 (e.g. 0.5, not 128).',
  inputSchema: z.object({
    lightId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_lights.'),
    on: z.boolean().optional().describe('true=on, false=off'),
    hue: z.coerce.number().min(0).max(1).optional().describe('0 to 1 only. 0=red, 0.33=green, 0.66=blue'),
    saturation: z.coerce.number().min(0).max(1).optional().describe('0 to 1 only. 0=white, 1=vivid color'),
    lightness: z.coerce.number().min(0).max(1).optional().describe('0 to 1 only. 0=off, 0.5=medium, 1=bright'),
    colorTemp: z.coerce.number().min(153).max(500).optional().describe('153 to 500. Cool=153, warm=500'),
    transitionTime: z.coerce.number().min(0).optional().describe('100ms units (10=1sec)'),
  }),
}, async ({ lightId, on, hue, saturation, lightness, colorTemp, transitionTime }) => {
  if (!isConfigured()) return notConfigured();
  try {
    await hueClient.setLightState(lightId, { on, bri: toBri(lightness), hue: toHue(hue), sat: toSat(saturation), ct: colorTemp, transitiontime: transitionTime });
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
  description: 'Set the brightness of all lights in a room (1-254)',
  inputSchema: z.object({
    roomId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_rooms.'),
    brightness: z.coerce.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ roomId, brightness }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomBrightness(roomId, brightness); return ok(`Room ${roomId} brightness set to ${brightness}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_color', {
  title: 'Set Room Color',
  description: 'Set color of all lights in a room. Example: red at full brightness = hue:0, saturation:1, lightness:1',
  inputSchema: z.object({
    roomId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_rooms.'),
    hue: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=red, 0.33=green, 0.66=blue'),
    saturation: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=white, 1=vivid color'),
    lightness: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=off, 0.5=medium, 1=bright'),
  }),
}, async ({ roomId, hue, saturation, lightness }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomColor(roomId, hue, saturation, lightness); return ok(`Room ${roomId} color set`); }
  catch (e) { return err(e); }
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
  description: 'Set multiple properties of all lights in a room. HSL values must be 0 to 1 (e.g. 0.5, not 128).',
  inputSchema: z.object({
    roomId: z.string().describe('Numeric ID (e.g. "1", "2"). Get IDs from list_rooms.'),
    on: z.boolean().optional().describe('true=on, false=off'),
    hue: z.coerce.number().min(0).max(1).optional().describe('0 to 1 only. 0=red, 0.33=green, 0.66=blue'),
    saturation: z.coerce.number().min(0).max(1).optional().describe('0 to 1 only. 0=white, 1=vivid color'),
    lightness: z.coerce.number().min(0).max(1).optional().describe('0 to 1 only. 0=off, 0.5=medium, 1=bright'),
    colorTemp: z.coerce.number().min(153).max(500).optional().describe('153 to 500. Cool=153, warm=500'),
    transitionTime: z.coerce.number().min(0).optional().describe('100ms units (10=1sec)'),
  }),
}, async ({ roomId, on, hue, saturation, lightness, colorTemp, transitionTime }) => {
  if (!isConfigured()) return notConfigured();
  try {
    await hueClient.setRoomState(roomId, { on, bri: toBri(lightness), hue: toHue(hue), sat: toSat(saturation), ct: colorTemp, transitiontime: transitionTime });
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
  description: 'Set color of ALL lights. Example: red at full brightness = hue:0, saturation:1, lightness:1',
  inputSchema: z.object({
    hue: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=red, 0.33=green, 0.66=blue'),
    saturation: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=white, 1=vivid color'),
    lightness: z.coerce.number().min(0).max(1).describe('0 to 1 only. 0=off, 0.5=medium, 1=bright'),
  }),
}, async ({ hue, saturation, lightness }) => {
  if (!isConfigured()) return notConfigured();
  try {
    await hueClient.setRoomState('0', { on: true, bri: toBri(lightness), hue: toHue(hue), sat: toSat(saturation) });
    return ok('All lights color set');
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
    const response = await axios.get('https://discovery.meethue.com/', { timeout: 10000 });
    const bridges = response.data;
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
    const response = await axios.post(`https://${bridgeIp}/api`, { devicetype: `${appName}#${deviceName}` }, { httpsAgent, timeout: 10000 });
    const result = response.data;

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
