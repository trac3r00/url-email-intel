import fs from 'node:fs';
import path from 'node:path';
const envPath = path.resolve(import.meta.dirname, '..', 'data', 'local-env.json');
const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
Object.assign(process.env, env);
await import('../server/index.js');
