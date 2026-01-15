# Philips Hue MCP Server

An MCP (Model Context Protocol) server for controlling Philips Hue lights via AI assistants like Claude.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HUE_BRIDGE_IP` | Yes | IP address of your Philips Hue bridge |
| `HUE_USERNAME` | Yes | API token/username for authentication |
| `PORT` | No | Server port (default: 3100) |

## Getting Credentials

1. Find your bridge IP using the `discover_bridges` tool or check your router
2. Press the button on top of your Hue bridge
3. Within 30 seconds, use the `create_auth_token` tool
4. Save the returned username

## Docker

### Pull from GitHub Container Registry

```bash
docker pull ghcr.io/redaphid/philips-hue-mcp:latest
```

### Run

```bash
docker run -d \
  --name philips-hue-mcp \
  --network host \
  -e HUE_BRIDGE_IP=10.0.2.3 \
  -e HUE_USERNAME=your-token-here \
  ghcr.io/redaphid/philips-hue-mcp:latest
```

> **Note:** `--network host` is required so the container can reach your Hue bridge on the local network.

### Docker Compose

```yaml
services:
  philips-hue-mcp:
    image: ghcr.io/redaphid/philips-hue-mcp:latest
    network_mode: host
    environment:
      - HUE_BRIDGE_IP=10.0.2.3
      - HUE_USERNAME=your-token-here
    restart: unless-stopped
```

## Local Development

```bash
# Install dependencies
npm install

# Create .env file
echo "HUE_BRIDGE_IP=10.0.2.3" >> .env
echo "HUE_USERNAME=your-token" >> .env

# Run with watch mode
npm run dev
```

## MCP Client Configuration

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "philips-hue": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

## Available Tools

- `list_lights` / `get_light` - Query light state
- `turn_light_on` / `turn_light_off` - Control individual lights
- `set_light_brightness` / `set_light_color` / `set_light_color_temp` - Adjust light properties
- `list_rooms` / `turn_room_on` / `turn_room_off` - Room controls
- `list_scenes` / `activate_scene` - Scene management
- `turn_all_lights_on` / `turn_all_lights_off` - Global controls
- `discover_bridges` / `create_auth_token` / `test_connection` - Setup tools
