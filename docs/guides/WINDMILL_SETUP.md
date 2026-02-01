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

Replace `<username>` with your Windmill username:

```bash
wmill variable create u/<username>/DATABASE_URL --value "$DATABASE_URL"
wmill variable create u/<username>/GROQ_API_KEY --value "$GROQ_API_KEY" --secret
wmill variable create u/<username>/LANGFUSE_PUBLIC_KEY --value "$LANGFUSE_PUBLIC_KEY"
wmill variable create u/<username>/LANGFUSE_SECRET_KEY --value "$LANGFUSE_SECRET_KEY" --secret
wmill variable create u/<username>/LANGFUSE_BASE_URL --value "$LANGFUSE_BASE_URL"
wmill variable create u/<username>/LLM_PROVIDER --value "groq"
wmill variable create f/process_contract/SERVICE_URL --value "http://host.docker.internal:3000"
```

### Via UI

1. Go to **Variables** in the left sidebar
2. Click **+ Variable**
3. Create each variable with the path and value from your `.env` file
4. Mark API keys as **secret**

## 5. Deploy scripts and flow

Push the thin HTTP caller scripts and the flow definition to Windmill:

```bash
# Push scripts (from project root)
wmill sync push --yes

# Push the flow separately (sync push doesn't handle flows in f/)
# Replace <username> with your Windmill username
wmill flow push f/process-contract.flow u/<username>/process_contract
```

The scripts land at `f/process_contract/*` (synced from the `f/` directory). The flow must be pushed to a user-scoped path (`u/<username>/`) because Windmill's `proper_id` constraint requires a registered namespace.

## 6. Verify

1. Windmill UI loads at http://localhost:8000
2. Login with default credentials
3. Variables are visible under Settings → Variables
4. Scripts visible under **Scripts** → `f/process_contract/` folder
5. Flow visible under **Flows** → `u/<username>/process_contract`
6. Start the Express service (`npm run dev`) and trigger the flow with a test PDF:
   ```bash
   # Generate base64 from a test PDF
   base64 -w0 test/fixtures/vattenfall-energy.pdf | pbcopy  # or xclip
   ```
   Then run the flow in Windmill UI with `pdfBase64` and `verticalSlug: energy`.

## 7. Stop Windmill

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
