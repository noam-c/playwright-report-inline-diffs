import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import type { FullResult, Reporter } from '@playwright/test/reporter';

type ReporterOptions = {
  outputFolder?: string;
};

type ReportAttachment = {
  name: string;
  contentType: string;
  path?: string;
};

type ReportTest = {
  testId: string;
  title: string;
  path: string[];
  ok: boolean;
  results: { attachments: ReportAttachment[] }[];
};

type HTMLReport = {
  files: { tests: ReportTest[] }[];
};

type ImageDiff = {
  name: string;
  expected?: string;
  actual?: string;
  diff?: string;
};

type TestDiffs = {
  testId: string;
  diffs: ImageDiff[];
};

// Resolve the assets/ directory relative to the compiled JS entry point
// (dist/index.js → ../assets/)
const assetsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
);

class InlineSnapshotReporter implements Reporter {
  private outputFolder: string;

  constructor(options: ReporterOptions = {}) {
    this.outputFolder = options.outputFolder || 'playwright-report';
  }

  printsToStdio() {
    return false;
  }

  async onEnd(_result: FullResult) {
    const indexPath = path.resolve(this.outputFolder, 'index.html');
    if (!fs.existsSync(indexPath)) return;

    const html = fs.readFileSync(indexPath, 'utf-8');

    // The Playwright HTML reporter embeds report data as a base-64 data-URI
    // inside a <script> tag. We extract that, decode the zip, and pull out
    // report.json to find which tests have snapshot diffs.
    const scriptMatch = html.match(
      /<script id="playwrightReportBase64"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!scriptMatch) return;

    const report = extractReport(scriptMatch[1].trim());
    if (!report) return;

    const testDiffs = collectTestDiffs(report);
    if (testDiffs.length === 0) return;

    // Copy the client-side CSS + JS into the report folder, then inject a
    // small snippet into index.html that wires them up with the diff data.
    const reportDir = path.dirname(indexPath);

    fs.copyFileSync(
      path.join(assetsDir, 'inline-diffs.css'),
      path.join(reportDir, 'inline-diffs.css'),
    );
    fs.copyFileSync(
      path.join(assetsDir, 'inline-diffs.js'),
      path.join(reportDir, 'inline-diffs.js'),
    );

    const injection = [
      `<link rel="stylesheet" href="inline-diffs.css">`,
      `<script>window.__INLINE_SNAPSHOT_DIFFS__=${JSON.stringify(testDiffs)};</script>`,
      `<script src="inline-diffs.js"></script>`,
    ].join('\n');

    fs.writeFileSync(
      indexPath,
      html.replace('</body>', injection + '\n</body>'),
      'utf-8',
    );
  }
}

/** Decode the base-64 data-URI, unzip it, and parse report.json. */
function extractReport(dataUri: string): HTMLReport | undefined {
  const b64 = dataUri.replace(/^data:[^,]+,/, '');

  try {
    const entry = new AdmZip(Buffer.from(b64, 'base64')).getEntry('report.json');
    if (entry) return JSON.parse(entry.getData().toString('utf-8'));
  } catch {}

  return undefined;
}

/** Walk every failed test result and collect snapshot image diffs. */
function collectTestDiffs(report: HTMLReport): TestDiffs[] {
  return report.files.flatMap(file =>
    file.tests
      .filter(test => !test.ok)
      .flatMap(test =>
        test.results
          .map(result => ({
            testId: test.testId,
            diffs: extractImageDiffs(result.attachments),
          }))
          .filter(td => td.diffs.length > 0),
      ),
  );
}

/**
 * Group a result's image attachments into snapshot diffs.
 *
 * Playwright names screenshot attachments like:
 *   "homepage-expected.png", "homepage-actual.png", "homepage-diff.png"
 *
 * We group by the base name ("homepage.png") and collect the expected/actual/
 * diff paths into a single ImageDiff object. Only diffs that have both an
 * expected and actual image are returned.
 */
function extractImageDiffs(attachments: ReportAttachment[]): ImageDiff[] {
  const bySnapshot = new Map<string, ImageDiff>();

  for (const att of attachments) {
    if (att.name.startsWith('_') || !att.contentType.startsWith('image/')) continue;

    // e.g. "homepage-expected.png" → baseName="homepage", category="expected", ext=".png"
    const match = att.name.match(/^(.*)-(expected|actual|diff|previous)(\.[^.]+)?$/);
    if (!match) continue;

    const [, baseName, category, ext = ''] = match;
    const key = baseName + ext;

    let info = bySnapshot.get(key);
    if (!info) {
      info = { name: key };
      bySnapshot.set(key, info);
    }

    if (category === 'actual') info.actual = att.path;
    if (category === 'expected' || category === 'previous') info.expected = att.path;
    if (category === 'diff') info.diff = att.path;
  }

  return [...bySnapshot.values()].filter(d => d.actual && d.expected);
}

export default InlineSnapshotReporter;
