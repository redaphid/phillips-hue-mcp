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
  description: 'Get a list of all Philips Hue lights with their current state',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getLights()); }
  catch (e) { return err(e); }
});

server.registerTool('get_light', {
  title: 'Get Light',
  description: 'Get details of a specific light by its ID',
  inputSchema: z.object({ lightId: z.string().describe('The ID of the light to get') }),
}, async ({ lightId }) => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getLight(lightId)); }
  catch (e) { return err(e); }
});

server.registerTool('turn_light_on', {
  title: 'Turn Light On',
  description: 'Turn on a specific light',
  inputSchema: z.object({ lightId: z.string().describe('The ID of the light to turn on') }),
}, async ({ lightId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnLightOn(lightId); return ok(`Light ${lightId} turned on`); }
  catch (e) { return err(e); }
});

server.registerTool('turn_light_off', {
  title: 'Turn Light Off',
  description: 'Turn off a specific light',
  inputSchema: z.object({ lightId: z.string().describe('The ID of the light to turn off') }),
}, async ({ lightId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnLightOff(lightId); return ok(`Light ${lightId} turned off`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_brightness', {
  title: 'Set Light Brightness',
  description: 'Set the brightness of a specific light (1-254)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    brightness: z.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ lightId, brightness }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setBrightness(lightId, brightness); return ok(`Light ${lightId} brightness set to ${brightness}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_color', {
  title: 'Set Light Color',
  description: 'Set the color of a specific light using hue (0-65535) and saturation (0-254)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    hue: z.number().min(0).max(65535).describe('Hue value (0-65535, where 0/65535=red, ~21845=green, ~43690=blue)'),
    saturation: z.number().min(0).max(254).describe('Saturation value (0-254, 0=white, 254=full color)'),
  }),
}, async ({ lightId, hue, saturation }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setColor(lightId, hue, saturation); return ok(`Light ${lightId} color set to hue=${hue}, saturation=${saturation}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_color_temp', {
  title: 'Set Light Color Temperature',
  description: 'Set the color temperature of a specific light in mireds (153-500, lower=cooler/bluer, higher=warmer/yellower)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    colorTemp: z.number().min(153).max(500).describe('Color temperature in mireds (153=cool daylight, 500=warm candlelight)'),
  }),
}, async ({ lightId, colorTemp }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setColorTemp(lightId, colorTemp); return ok(`Light ${lightId} color temperature set to ${colorTemp} mireds`); }
  catch (e) { return err(e); }
});

server.registerTool('set_light_state', {
  title: 'Set Light State',
  description: 'Set multiple properties of a light at once',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    on: z.boolean().optional().describe('Turn light on or off'),
    brightness: z.number().min(1).max(254).optional().describe('Brightness (1-254)'),
    hue: z.number().min(0).max(65535).optional().describe('Hue (0-65535)'),
    saturation: z.number().min(0).max(254).optional().describe('Saturation (0-254)'),
    colorTemp: z.number().min(153).max(500).optional().describe('Color temperature in mireds'),
    transitionTime: z.number().min(0).optional().describe('Transition time in 100ms increments (e.g., 10 = 1 second)'),
  }),
}, async ({ lightId, on, brightness, hue, saturation, colorTemp, transitionTime }) => {
  if (!isConfigured()) return notConfigured();
  try {
    await hueClient.setLightState(lightId, { on, bri: brightness, hue, sat: saturation, ct: colorTemp, transitiontime: transitionTime });
    return ok(`Light ${lightId} state updated`);
  } catch (e) { return err(e); }
});

// ============================================
// ROOM TOOLS
// ============================================

server.registerTool('list_rooms', {
  title: 'List Rooms',
  description: 'Get a list of all rooms and zones',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getRooms()); }
  catch (e) { return err(e); }
});

server.registerTool('list_groups', {
  title: 'List All Groups',
  description: 'Get a list of all groups including rooms, zones, and entertainment areas',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getAllGroups()); }
  catch (e) { return err(e); }
});

server.registerTool('get_room', {
  title: 'Get Room',
  description: 'Get details of a specific room by its ID',
  inputSchema: z.object({ roomId: z.string().describe('The ID of the room') }),
}, async ({ roomId }) => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getRoom(roomId)); }
  catch (e) { return err(e); }
});

server.registerTool('turn_room_on', {
  title: 'Turn Room On',
  description: 'Turn on all lights in a room',
  inputSchema: z.object({ roomId: z.string().describe('The ID of the room') }),
}, async ({ roomId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnRoomOn(roomId); return ok(`Room ${roomId} turned on`); }
  catch (e) { return err(e); }
});

server.registerTool('turn_room_off', {
  title: 'Turn Room Off',
  description: 'Turn off all lights in a room',
  inputSchema: z.object({ roomId: z.string().describe('The ID of the room') }),
}, async ({ roomId }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.turnRoomOff(roomId); return ok(`Room ${roomId} turned off`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_brightness', {
  title: 'Set Room Brightness',
  description: 'Set the brightness of all lights in a room (1-254)',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    brightness: z.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ roomId, brightness }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomBrightness(roomId, brightness); return ok(`Room ${roomId} brightness set to ${brightness}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_color', {
  title: 'Set Room Color',
  description: 'Set the color of all lights in a room using hue and saturation',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    hue: z.number().min(0).max(65535).describe('Hue value (0-65535)'),
    saturation: z.number().min(0).max(254).describe('Saturation value (0-254)'),
  }),
}, async ({ roomId, hue, saturation }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomColor(roomId, hue, saturation); return ok(`Room ${roomId} color set to hue=${hue}, saturation=${saturation}`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_color_temp', {
  title: 'Set Room Color Temperature',
  description: 'Set the color temperature of all lights in a room in mireds',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    colorTemp: z.number().min(153).max(500).describe('Color temperature in mireds (153-500)'),
  }),
}, async ({ roomId, colorTemp }) => {
  if (!isConfigured()) return notConfigured();
  try { await hueClient.setRoomColorTemp(roomId, colorTemp); return ok(`Room ${roomId} color temperature set to ${colorTemp} mireds`); }
  catch (e) { return err(e); }
});

server.registerTool('set_room_state', {
  title: 'Set Room State',
  description: 'Set multiple properties of all lights in a room at once',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    on: z.boolean().optional().describe('Turn lights on or off'),
    brightness: z.number().min(1).max(254).optional().describe('Brightness (1-254)'),
    hue: z.number().min(0).max(65535).optional().describe('Hue (0-65535)'),
    saturation: z.number().min(0).max(254).optional().describe('Saturation (0-254)'),
    colorTemp: z.number().min(153).max(500).optional().describe('Color temperature in mireds'),
    transitionTime: z.number().min(0).optional().describe('Transition time in 100ms increments'),
  }),
}, async ({ roomId, on, brightness, hue, saturation, colorTemp, transitionTime }) => {
  if (!isConfigured()) return notConfigured();
  try {
    await hueClient.setRoomState(roomId, { on, bri: brightness, hue, sat: saturation, ct: colorTemp, transitiontime: transitionTime });
    return ok(`Room ${roomId} state updated`);
  } catch (e) { return err(e); }
});

// ============================================
// SCENE TOOLS
// ============================================

server.registerTool('list_scenes', {
  title: 'List Scenes',
  description: 'Get a list of all available scenes',
}, async () => {
  if (!isConfigured()) return notConfigured();
  try { return json(await hueClient.getScenes()); }
  catch (e) { return err(e); }
});

server.registerTool('activate_scene', {
  title: 'Activate Scene',
  description: 'Activate a specific scene',
  inputSchema: z.object({
    sceneId: z.string().describe('The ID of the scene to activate'),
    groupId: z.string().optional().describe('Optional group ID to apply the scene to'),
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
