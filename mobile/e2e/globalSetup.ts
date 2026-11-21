import * as fs from 'node:fs';
import * as path from 'node:path';

/** Start each run with no screenshots from the last one, so every image in output/ is current. */
export default function globalSetup(): void {
  const out = path.join(__dirname, 'output');
  if (!fs.existsSync(out)) return;
  for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.rmSync(path.join(out, f));
}
