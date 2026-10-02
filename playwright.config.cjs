const { defineConfig } = require('@playwright/test');
const baseURL = `http://127.0.0.1:${Number(process.env.PORT || 4173)}`;
module.exports = defineConfig({
  testDir: './tests/e2e', timeout: 30000, fullyParallel: false,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1,
  reporter: [['list'], ['html', {open:'never'}]],
  use: {baseURL, headless:true, launchOptions: process.env.RENEW_TEST_CHROMIUM ? {executablePath:process.env.RENEW_TEST_CHROMIUM} : {}, viewport:{width:1440,height:1000}, colorScheme:'dark', trace:'retain-on-failure', screenshot:'only-on-failure'},
  webServer: {command:'node scripts/preview.cjs', url:baseURL, reuseExistingServer:false, timeout:15000}
});
