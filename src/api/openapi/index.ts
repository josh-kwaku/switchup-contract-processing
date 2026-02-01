import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import type { Express } from 'express';

const currentDir = dirname(fileURLToPath(import.meta.url));
const specPath = join(currentDir, 'spec.yaml');
const spec = YAML.parse(readFileSync(specPath, 'utf-8'));

export function setupOpenAPI(app: Express): void {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'SwitchUp Contract Processing API',
  }));

  app.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
}
