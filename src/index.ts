import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { HueClient } from './hue-client.js';
import { randomUUID } from 'node:crypto';

const HUE_BRIDGE_IP = process.env.HUE_BRIDGE_IP || '10.0.2.3';
const HUE_USERNAME = process.env.HUE_USERNAME || 'siZ0XL9p7-cSbJchW6gV6Ze587hpBo4-xC2Vx8Wg';
const PORT = parseInt(process.env.PORT || '3100', 10);

const hueClient = new HueClient(HUE_BRIDGE_IP, HUE_USERNAME);

const server = new McpServer({
  name: 'philips-hue-mcp',
  version: '1.0.0',
});

// List all lights
server.registerTool('list_lights', {
  title: 'List Lights',
  description: 'Get a list of all Philips Hue lights with their current state',
}, async () => {
  try {
    const lights = await hueClient.getLights();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(lights, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Get single light details
server.registerTool('get_light', {
  title: 'Get Light',
  description: 'Get details of a specific light by its ID',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light to get'),
  }),
}, async ({ lightId }) => {
  try {
    const light = await hueClient.getLight(lightId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(light, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn light on
server.registerTool('turn_light_on', {
  title: 'Turn Light On',
  description: 'Turn on a specific light',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light to turn on'),
  }),
}, async ({ lightId }) => {
  try {
    await hueClient.turnLightOn(lightId);
    return {
      content: [{ type: 'text', text: `Light ${lightId} turned on` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn light off
server.registerTool('turn_light_off', {
  title: 'Turn Light Off',
  description: 'Turn off a specific light',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light to turn off'),
  }),
}, async ({ lightId }) => {
  try {
    await hueClient.turnLightOff(lightId);
    return {
      content: [{ type: 'text', text: `Light ${lightId} turned off` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set light brightness
server.registerTool('set_light_brightness', {
  title: 'Set Light Brightness',
  description: 'Set the brightness of a specific light (1-254)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    brightness: z.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ lightId, brightness }) => {
  try {
    await hueClient.setBrightness(lightId, brightness);
    return {
      content: [{ type: 'text', text: `Light ${lightId} brightness set to ${brightness}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set light color
server.registerTool('set_light_color', {
  title: 'Set Light Color',
  description: 'Set the color of a specific light using hue (0-65535) and saturation (0-254)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    hue: z.number().min(0).max(65535).describe('Hue value (0-65535, where 0/65535=red, ~21845=green, ~43690=blue)'),
    saturation: z.number().min(0).max(254).describe('Saturation value (0-254, 0=white, 254=full color)'),
  }),
}, async ({ lightId, hue, saturation }) => {
  try {
    await hueClient.setColor(lightId, hue, saturation);
    return {
      content: [{ type: 'text', text: `Light ${lightId} color set to hue=${hue}, saturation=${saturation}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set light color temperature
server.registerTool('set_light_color_temp', {
  title: 'Set Light Color Temperature',
  description: 'Set the color temperature of a specific light in mireds (153-500, lower=cooler/bluer, higher=warmer/yellower)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    colorTemp: z.number().min(153).max(500).describe('Color temperature in mireds (153=cool daylight, 500=warm candlelight)'),
  }),
}, async ({ lightId, colorTemp }) => {
  try {
    await hueClient.setColorTemp(lightId, colorTemp);
    return {
      content: [{ type: 'text', text: `Light ${lightId} color temperature set to ${colorTemp} mireds` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set full light state
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
  try {
    await hueClient.setLightState(lightId, {
      on,
      bri: brightness,
      hue,
      sat: saturation,
      ct: colorTemp,
      transitiontime: transitionTime,
    });
    return {
      content: [{ type: 'text', text: `Light ${lightId} state updated` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// List rooms/groups
server.registerTool('list_rooms', {
  title: 'List Rooms',
  description: 'Get a list of all rooms and zones',
}, async () => {
  try {
    const rooms = await hueClient.getRooms();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(rooms, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// List all groups (including entertainment areas)
server.registerTool('list_groups', {
  title: 'List All Groups',
  description: 'Get a list of all groups including rooms, zones, and entertainment areas',
}, async () => {
  try {
    const groups = await hueClient.getAllGroups();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(groups, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Get room details
server.registerTool('get_room', {
  title: 'Get Room',
  description: 'Get details of a specific room by its ID',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
  }),
}, async ({ roomId }) => {
  try {
    const room = await hueClient.getRoom(roomId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(room, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn room on
server.registerTool('turn_room_on', {
  title: 'Turn Room On',
  description: 'Turn on all lights in a room',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
  }),
}, async ({ roomId }) => {
  try {
    await hueClient.turnRoomOn(roomId);
    return {
      content: [{ type: 'text', text: `Room ${roomId} turned on` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn room off
server.registerTool('turn_room_off', {
  title: 'Turn Room Off',
  description: 'Turn off all lights in a room',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
  }),
}, async ({ roomId }) => {
  try {
    await hueClient.turnRoomOff(roomId);
    return {
      content: [{ type: 'text', text: `Room ${roomId} turned off` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room brightness
server.registerTool('set_room_brightness', {
  title: 'Set Room Brightness',
  description: 'Set the brightness of all lights in a room (1-254)',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    brightness: z.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ roomId, brightness }) => {
  try {
    await hueClient.setRoomBrightness(roomId, brightness);
    return {
      content: [{ type: 'text', text: `Room ${roomId} brightness set to ${brightness}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room color
server.registerTool('set_room_color', {
  title: 'Set Room Color',
  description: 'Set the color of all lights in a room using hue and saturation',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    hue: z.number().min(0).max(65535).describe('Hue value (0-65535)'),
    saturation: z.number().min(0).max(254).describe('Saturation value (0-254)'),
  }),
}, async ({ roomId, hue, saturation }) => {
  try {
    await hueClient.setRoomColor(roomId, hue, saturation);
    return {
      content: [{ type: 'text', text: `Room ${roomId} color set to hue=${hue}, saturation=${saturation}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room color temperature
server.registerTool('set_room_color_temp', {
  title: 'Set Room Color Temperature',
  description: 'Set the color temperature of all lights in a room in mireds',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    colorTemp: z.number().min(153).max(500).describe('Color temperature in mireds (153-500)'),
  }),
}, async ({ roomId, colorTemp }) => {
  try {
    await hueClient.setRoomColorTemp(roomId, colorTemp);
    return {
      content: [{ type: 'text', text: `Room ${roomId} color temperature set to ${colorTemp} mireds` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room state
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
  try {
    await hueClient.setRoomState(roomId, {
      on,
      bri: brightness,
      hue,
      sat: saturation,
      ct: colorTemp,
      transitiontime: transitionTime,
    });
    return {
      content: [{ type: 'text', text: `Room ${roomId} state updated` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// List scenes
server.registerTool('list_scenes', {
  title: 'List Scenes',
  description: 'Get a list of all available scenes',
}, async () => {
  try {
    const scenes = await hueClient.getScenes();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(scenes, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Activate scene
server.registerTool('activate_scene', {
  title: 'Activate Scene',
  description: 'Activate a specific scene',
  inputSchema: z.object({
    sceneId: z.string().describe('The ID of the scene to activate'),
    groupId: z.string().optional().describe('Optional group ID to apply the scene to'),
  }),
}, async ({ sceneId, groupId }) => {
  try {
    await hueClient.activateScene(sceneId, groupId);
    return {
      content: [{ type: 'text', text: `Scene ${sceneId} activated${groupId ? ` in group ${groupId}` : ''}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn all lights off
server.registerTool('turn_all_lights_off', {
  title: 'Turn All Lights Off',
  description: 'Turn off all lights in the house',
}, async () => {
  try {
    await hueClient.setRoomState('0', { on: false });
    return {
      content: [{ type: 'text', text: 'All lights turned off' }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn all lights on
server.registerTool('turn_all_lights_on', {
  title: 'Turn All Lights On',
  description: 'Turn on all lights in the house',
}, async () => {
  try {
    await hueClient.setRoomState('0', { on: true });
    return {
      content: [{ type: 'text', text: 'All lights turned on' }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Store active transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data !== undefined) {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function main() {
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  // Log all incoming requests
  app.use((req, res, next) => {
    log(`${req.method} ${req.path}`, {
      headers: req.headers,
      body: req.body,
    });
    next();
  });

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    log(`POST /mcp - session: ${sessionId || 'none'}`);

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        log(`Reusing transport for session: ${sessionId}`);
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        log('New initialization request, creating transport');
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            log(`Session initialized: ${sid}`);
            transports[sid] = transport;
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            log(`Transport closed, removing session: ${sid}`);
            delete transports[sid];
          }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        // Invalid request
        log('Bad request: no session ID and not an initialize request');
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log('Error handling POST request', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    log(`GET /mcp - session: ${sessionId || 'none'}`);

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    log(`DELETE /mcp - session: ${sessionId || 'none'}`);

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    try {
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    } catch (error) {
      log('Error handling DELETE request', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  app.listen(PORT, () => {
    log(`Philips Hue MCP server running on http://0.0.0.0:${PORT}/mcp`);
    log(`Bridge IP: ${HUE_BRIDGE_IP}`);
  });
}

main().catch(console.error);
