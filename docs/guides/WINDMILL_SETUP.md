# Windmill Local Setup Guide

## Prerequisites

- Docker and Docker Compose
- Node.js 18+

## 1. Start Windmill

```bash
docker-compose up -d
```

Windmill UI will be available at **http://localhost:8000**.

### Default credentials

- **Email**: `admin@windmill.dev`
- **Password**: `changeme`

## 2. Install wmill CLI

```bash
npm install -g windmill-client
```

## 3. Configure workspace

After logging into the Windmill UI, a default workspace is created automatically. Connect the CLI:

```bash
wmill workspace add switchup switchup http://localhost:8000 --token <YOUR_TOKEN>
```

To get a token: Windmill UI → User Settings (top right) → Tokens → Create Token.

Then set as default:

```bash
wmill workspace switch switchup
```

## 4. Create resources (variables)

Create these as **variables** in Windmill (Settings → Variables, or via CLI). These allow workflow scripts to access external services.

### Via CLI

```bash
wmill variable create u/kwakujosh/DATABASE_URL --value "$DATABASE_URL"
wmill variable create u/kwakujosh/GROQ_API_KEY --value "$GROQ_API_KEY" --secret
wmill variable create u/kwakujosh/LANGFUSE_PUBLIC_KEY --value "$LANGFUSE_PUBLIC_KEY"
wmill variable create u/kwakujosh/LANGFUSE_SECRET_KEY --value "$LANGFUSE_SECRET_KEY" --secret
wmill variable create u/kwakujosh/LANGFUSE_BASE_URL --value "$LANGFUSE_BASE_URL"
wmill variable create u/kwakujosh/LLM_PROVIDER --value "groq"
```

### Via UI

1. Go to **Variables** in the left sidebar
2. Click **+ Variable**
3. Create each variable with the path and value from your `.env` file
4. Mark API keys as **secret**

## 5. Verify

1. Windmill UI loads at http://localhost:8000
2. Login with default credentials
3. Variables are visible under Settings → Variables
4. Create a test script to verify variable access:

```typescript
import * as wmill from "windmill-client";

export async function main() {
  const dbUrl = await wmill.getVariable("u/kwakujosh/DATABASE_URL");
  return { hasDbUrl: !!dbUrl };
}
```

## 6. Stop Windmill

```bash
docker-compose down
```

To also remove volumes (full reset):

```bash
docker-compose down -v
```

## Troubleshooting

- **Port 8000 in use**: Change the port mapping in `docker-compose.yml` (e.g., `8001:8000`)
- **Docker socket permission**: On Linux, ensure your user is in the `docker` group
- **Workers not starting**: Check logs with `docker-compose logs windmill_worker`
