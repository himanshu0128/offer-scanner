export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = await import('node-cron');
    const { runOfferScan } = await import('./lib/scanner');

    // Run nightly at 2:00 AM server time
    cron.default.schedule('0 2 * * *', async () => {
      console.log('[Nightly Cron] Starting automated 30-day email offer scan...');
      try {
        const result = await runOfferScan('nightly_cron');
        console.log('[Nightly Cron] Completed:', result);
      } catch (err) {
        console.error('[Nightly Cron] Failed:', err);
      }
    });
  }
}
