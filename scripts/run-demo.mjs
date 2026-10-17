import { spawn } from 'node:child_process';
function run(file, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
const code = await run('tests/demo-browser.mjs', process.argv.slice(2));
const generated = await run('scripts/generate-manual.mjs');
process.exitCode = code || generated;
