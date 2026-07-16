import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure' },
  webServer: {
    command: 'env NODE_ENV=test DATA_DIR=.e2e-data PORT=4178 PUBLIC_URL=http://127.0.0.1:4178 ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=password123 SESSION_SECRET=e2e-secret npm start',
    url: 'http://127.0.0.1:4178/api/health',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
