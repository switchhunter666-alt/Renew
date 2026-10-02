const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e', timeout: 30000, fullyParallel: false,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1,
  reporter: [['list'], ['html', {open:'never'}]],
  use: {baseURL:'http://127.0.0.1:4173', viewport:{width:1440,height:1000}, colorScheme:'dark', trace:'retain-on-failure', screenshot:'only-on-failure'},
  webServer: {command:'node scripts/preview.cjs', url:'http://127.0.0.1:4173', reuseExistingServer:!process.env.CI, timeout:15000}
});
