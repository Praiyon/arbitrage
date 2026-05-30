// Manual one-time warmup for the FD persistent browser profile.
//
// FanDuel sits behind PerimeterX. After a few unattended Playwright runs,
// PX challenges the next session with a press-and-hold CAPTCHA. This script
// opens the persistent profile headed, navigates to FD's MLB page, and
// hands control to you so you can solve the challenge with the spacebar.
// Once cleared, PX writes a "trusted" cookie (`_px3`) into the profile that
// survives across runs — so subsequent automated `BrowserRuntime.start()`
// calls reuse it and don't re-trigger the challenge.
//
// Run:  npx tsx warmup-fd.ts
//
// In the headed window:
//   1. If the press-and-hold challenge appears, hold the spacebar (or
//      whatever the challenge instructs) until it clears.
//   2. Wait until you can see the MLB games rendering normally.
//   3. Press Enter in this terminal to close and persist the cookies.

import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
chromium.use(stealth())

const PROFILE_DIR = './browser-profile'

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1280, height: 900 },
})

const page = await context.newPage()
await page.goto('https://sportsbook.fanduel.com/navigation/mlb', {
  waitUntil: 'domcontentloaded',
})

console.log(`\nProfile dir: ${PROFILE_DIR}`)
console.log('Solve the PerimeterX challenge if it appears, then make sure MLB games render.')
console.log('Press Enter here when ready to close and save the profile...')

await new Promise<void>((resolve) => {
  process.stdin.resume()
  process.stdin.once('data', () => resolve())
})

await context.close()
console.log('Profile warmed and closed.')
process.exit(0)
