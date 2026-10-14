import {validateConfig} from './github.js';
export async function protectStorage() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  await chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
}
export async function readConfig() {
  const local = await chrome.storage.local.get(['githubConfig', 'githubToken']);
  const session = await chrome.storage.session.get('githubToken');
  return {config: local.githubConfig || {owner: '', repo: '', branch: ''}, token: session.githubToken || local.githubToken || '', remember: !!local.githubToken};
}
export async function saveConfig(config, token, remember) {
  await protectStorage();
  const validated = validateConfig(config);
  await chrome.storage.local.set({githubConfig: validated});
  await chrome.storage.session.set({githubToken: token.trim()});
  if (remember) await chrome.storage.local.set({githubToken: token.trim()}); else await chrome.storage.local.remove('githubToken');
}
export async function forgetToken() { await chrome.storage.session.remove('githubToken'); await chrome.storage.local.remove('githubToken'); }
