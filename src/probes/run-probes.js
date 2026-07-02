/**
 * ARS probe runner — Protocol v2 §8.3
 * Runs the 6 Agent-Readiness probes against every property, from the current
 * egress (residential on laptop, datacenter on Hetzner). Writes one JSON per
 * property to data/ars/<egress>/ and a summary CSV. Re-run from both egresses;
 * the CW delta = cloud-agent-hostility signal (Protocol RQ4).
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPERTIES } from '../../properties_v2.js';
import { assessAgentReadiness } from './ars.js';
import { UA, getEgress, getCommitHash, nowIso, lookupEgressIP, safeSlug } from '../util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

async function main() {
  const egress = getEgress();
  const commit = getCommitHash();
  const ipinfo = await lookupEgressIP();
  const outDir = join(ROOT, 'data', 'ars', egress);
  mkdirSync(outDir, { recursive: true });

  const filter = process.argv[2]; // optional system filter
  const props = filter ? PROPERTIES.filter((p) => p.system === filter) : PROPERTIES;

  const browser = await chromium.launch({ headless: true });
  const summary = [];
  for (const prop of props) {
    const context = await browser.newContext({
      userAgent: UA.desktop,
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
    });
    context.setDefaultTimeout(20000);
    const page = await context.newPage();
    process.stdout.write(`  [${egress}] ARS · ${prop.system} · ${prop.name} ... `);
    let result;
    try {
      result = await assessAgentReadiness(page, context, {
        homepageUrl: prop.homepageUrl,
        bookingUrl: prop.bookingUrl || prop.homepageUrl,
        systemKey: prop.system,
      });
    } catch (e) {
      result = { ars: 0, signals: {}, evidence: { fatal: String(e).slice(0, 200) } };
    }
    const record = {
      system: prop.system, name: prop.name, egress, geo: ipinfo.country || getEgressGeoFallback(egress),
      ip: ipinfo.ip, org: ipinfo.org, commit, ts: nowIso(),
      homepageUrl: prop.homepageUrl, bookingUrl: prop.bookingUrl || prop.homepageUrl,
      ...result,
    };
    const file = join(outDir, `${safeSlug(prop.system)}-${safeSlug(prop.name)}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2));
    summary.push({ system: prop.system, name: prop.name, ars: record.ars, ...record.signals });
    console.log(`ARS=${record.ars}  SD=${record.signals.SD} BM=${record.signals.BM} CW=${record.signals.CW} AP=${record.signals.AP} API=${record.signals.API} PA=${record.signals.PA}`);
    await context.close().catch(() => {});
  }
  await browser.close();

  // CSV summary
  const cols = ['system', 'name', 'ars', 'SD', 'BM', 'CW', 'AP', 'API', 'PA'];
  const csv = [cols.join(',')].concat(
    summary.map((s) => cols.map((c) => s[c] ?? '').join(','))
  ).join('\n');
  writeFileSync(join(outDir, '_summary.csv'), csv);
  console.log(`\nWrote ${summary.length} ARS records to ${outDir}`);
}

function getEgressGeoFallback(egress) { return egress === 'datacenter' ? 'EU' : 'ZA'; }

main().catch((e) => { console.error(e); process.exit(1); });
