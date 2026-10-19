import { initI18n } from './lib/i18n.js';
await initI18n();
const entry = new URL(import.meta.url).searchParams.get('entry');
if (['app', 'start', 'welcome', 'manual', 'microphone'].includes(entry))
  await import(`./${entry}.js`);
