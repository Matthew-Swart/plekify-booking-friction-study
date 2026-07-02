/**
 * Study A/B runner — Protocol v2 §4–§8
 * Human-friction axis. Runs the flow handlers, collects all 7 grounded-LFI
 * terms, classifies the outcome (§6), applies the ITT penalty for non-completed
 * runs (§7), and writes one JSON per run + a flattened CSV.
 *
 *   node src/runner.js [--system X] [--study A|B|both] [--viewport desktop|mobile|both]
 *                      [--runs N] [--limit M] [--out DIR]
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPERTIES, VIEWPORTS } from '../properties_v2.js';
import { Metrics } from './metrics.js';
import { classifyOutcome } from './outcome.js';
import { REGISTRY } from './handlers.js';
import { ittPenaltyLfi } from './formulas.js';
import { UA, getEgress, getCommitHash, nowIso, lookupEgressIP, rollingStudyBDates, safeSlug, sleep } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

async function main() {
  const system = arg('system', '');
  const study = arg('study', 'B');
  const viewport = arg('viewport', 'desktop');
  const runs = parseInt(arg('runs', '3'), 10);
  const limit = parseInt(arg('limit', '0'), 10);
  const egress = getEgress();
  const commit = getCommitHash();
  const ipinfo = await lookupEgressIP();
  const dates = rollingStudyBDates();

  const studies = study === 'both' ? ['A', 'B'] : [study];
  const viewports = viewport === 'both' ? ['desktop', 'mobile'] : [viewport];
  let props = PROPERTIES.filter((p) => !system || p.system === system);
  if (limit > 0) props = props.slice(0, limit);

  const outDir = join(ROOT, 'data', 'flows', egress);
  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, '_flows.csv');
  if (!existsSync(csvPath)) {
    appendFileSync(csvPath, ['system', 'property', 'study', 'viewport', 'run', 'egress', 'geo', 'outcome', 'reason',
      'clicks', 'handoffs', 'fields', 'latencySec', 'interruptions', 'autocomplete', 'accelerated', 'pageCount',
      'measuredLfi', 'scoredLfi', 'completionPct', 'durationSec', 'commit', 'ts'].join(',') + '\n');
  }

  if (process.env.STEALTH !== '0') chromium.use(StealthPlugin()); // stealth off only if STEALTH=0
  const browser = await chromium.launch({
    headless: !process.env.HEADED,                                  // HEADED=1 => visible Chrome (residential human-realistic)
    args: ['--disable-blink-features=AutomationControlled'],
  });
  let count = 0;
  for (const prop of props) {
    const HandlerCls = REGISTRY[prop.system] || REGISTRY.generic;
    for (const sv of studies) {
      for (const vp of viewports) {
        for (let r = 1; r <= runs; r++) {
          const vpConf = VIEWPORTS[vp];
          const context = await browser.newContext({
            userAgent: UA[vpConf.ua],
            viewport: { width: vpConf.width, height: vpConf.height },
            locale: 'en-US',
          });
          context.setDefaultTimeout(20000);
          const page = await context.newPage();
          const m = new Metrics(); m.attach(page);
          const handler = new HandlerCls(page, m);
          const t0 = Date.now();
          process.stdout.write(`  [${egress}/${vp}] ${prop.system} · ${prop.name} · ${sv} #${r} ... `);
          let ctx;
          try {
            // HARD per-run wall-clock cap — no single run can ever hang the machine.
            // If a flow loops (e.g. a site-side change breaks date selection), it is
            // killed at 150s and recorded as errored/run-timeout, then the context closes.
            const RUN_TIMEOUT_MS = 150000;
            ctx = await Promise.race([
              sv === 'B' ? handler.studyB(prop) : handler.studyA(prop),
              new Promise((_, rej) => setTimeout(() => rej(new Error('run-timeout (>150s)')), RUN_TIMEOUT_MS)),
            ]);
          } catch (e) { ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: String(e).slice(0, 160) }; }
          const durationSec = Number(((Date.now() - t0) / 1000).toFixed(1));

          // Measure payment-step signals if reached; else best-effort on current page.
          if (ctx.paymentReached) {
            await m.detectFields(page).catch(() => {});
            await m.detectAutocomplete(page).catch(() => {});
            await m.detectAccelerated(page).catch(() => {});
          }
          await m.detectInterruptions(page).catch(() => {});
          if (ctx.captcha || ctx.botWall) m.markInterruption(ctx.botWall ? 'bot-wall' : 'captcha');
          if (ctx.mandatoryAccountWall) m.markInterruption('account-wall');

          const snap = m.snapshot();
          const { outcome, reason } = classifyOutcome(ctx);
          const reachedPayment = outcome === 'reached-payment' || outcome === 'redirected-off-domain';
          const measuredLfi = reachedPayment ? snap.lfi : snap.lfi; // what the flow measured
          const scoredLfi = reachedPayment ? snap.lfi : Number(ittPenaltyLfi().toFixed(2)); // ITT penalty
          const completionPct = reachedPayment ? snap.completionPct : 0;

          const record = {
            system: prop.system, property: prop.name, study: sv, viewport: vp, run: r,
            egress, geo: ipinfo.country || (egress === 'datacenter' ? 'EU' : 'ZA'),
            outcome, reason, clicks: snap.clicks, handoffs: snap.handoffs, fields: snap.fields,
            latencySec: snap.latencySec, interruptions: snap.interruptions, autocomplete: snap.autocomplete,
            accelerated: snap.accelerated, pageCount: snap.pageCount, measuredLfi, scoredLfi,
            completionPct, durationSec, commit, ts: nowIso(), origins: snap.origins,
            dates: sv === 'B' ? { checkin: dates.checkin, checkout: dates.checkout } : null,
          };
          const file = join(outDir, `${sv}_${safeSlug(prop.system)}-${safeSlug(prop.name)}_${vp}_run${r}.json`);
          writeFileSync(file, JSON.stringify(record, null, 2));
          appendFileSync(csvPath, [record.system, record.property, record.study, record.viewport, record.run,
            record.egress, record.geo, record.outcome, record.reason, record.clicks, record.handoffs, record.fields,
            record.latencySec, record.interruptions, record.autocomplete, record.accelerated, record.pageCount,
            record.measuredLfi, record.scoredLfi, record.completionPct, record.durationSec, record.commit, record.ts].map((x) => `"${x ?? ''}"`).join(',') + '\n');
          console.log(`${outcome} LFI=${scoredLfi} (${durationSec}s)`);
          count++;
          await context.close().catch(() => {});
          await sleep(2000);
        }
      }
    }
  }
  await browser.close();
  console.log(`\nWrote ${count} flow runs to ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
