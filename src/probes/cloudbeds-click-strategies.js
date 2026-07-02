/**
 * Try multiple click strategies on the Fatwave "Add" button to see which one
 * registers in the Cloudbeds Chakra cart.
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sleep } from '../util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function cartEmpty(page) {
  return page.evaluate(() => {
    const cart = document.querySelector('.cb-shopping-cart, [class*="shopping-cart" i]');
    if (!cart) return 'no-cart';
    return /no accommodations added|your cart is empty|0 rooms/i.test(cart.innerText || '') ? 'empty' : 'populated';
  }).catch(() => 'err');
}

async function tryStrategy(page, label, fn) {
  // fresh deep-link each time so cart is clean
  const today = new Date();
  const cinIso = iso(new Date(today.getTime() + 45 * 86400000));
  const coutIso = iso(new Date(today.getTime() + 47 * 86400000));
  await page.goto(`https://hotels.cloudbeds.com/en/reservation/SoRbvN/?checkin=${cinIso}&checkout=${coutIso}&adults=2`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(7000);
  await page.locator('button.cb-select-button').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  await sleep(800);
  console.log(`\n[${label}] cart before: ${await cartEmpty(page)}`);
  try {
    await fn();
  } catch (e) { console.log(`  ${label} threw: ${String(e).slice(0, 80)}`); }
  await sleep(2500);
  const after = await cartEmpty(page);
  console.log(`[${label}] cart after:  ${after}`);
  return after === 'populated';
}

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  ctx.setDefaultTimeout(12000);
  const page = await ctx.newPage();

  // Strategy 1: plain click
  await tryStrategy(page, 'plain click', async () => {
    await page.locator('button.cb-select-button').first().click({ timeout: 5000 });
  });

  // Strategy 2: force click
  await tryStrategy(page, 'force click', async () => {
    await page.locator('button.cb-select-button').first().click({ force: true, timeout: 5000 });
  });

  // Strategy 3: real mouse — move to the element, then mouse down/up
  await tryStrategy(page, 'mouse down/up', async () => {
    const box = await page.locator('button.cb-select-button').first().boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(150);
      await page.mouse.down();
      await sleep(60);
      await page.mouse.up();
    }
  });

  // Strategy 4: focus + keyboard Enter
  await tryStrategy(page, 'focus + Enter', async () => {
    await page.locator('button.cb-select-button').first().focus();
    await sleep(150);
    await page.keyboard.press('Enter');
  });

  // Strategy 5: dispatch native PointerEvent + MouseEvent via evaluate
  await tryStrategy(page, 'native events', async () => {
    await page.evaluate(() => {
      const b = document.querySelector('button.cb-select-button');
      if (!b) return;
      const opts = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true };
      b.dispatchEvent(new PointerEvent('pointerover', opts));
      b.dispatchEvent(new PointerEvent('pointerenter', opts));
      b.dispatchEvent(new PointerEvent('pointerdown', opts));
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      b.dispatchEvent(new PointerEvent('pointerup', opts));
      b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
  });

  // Strategy 6: click via the rate row's "Add Standard Rate" aria (sometimes the real target is a parent)
  await tryStrategy(page, 'parent-row click', async () => {
    await page.evaluate(() => {
      const b = document.querySelector('button.cb-select-button');
      // climb to the rate-plan container and click it
      let p = b;
      for (let i = 0; i < 6 && p; i++) { if (/cb-rate-plan|rate-plan/i.test(p.className || '')) break; p = p.parentElement; }
      (p || b).click();
    });
  });

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
