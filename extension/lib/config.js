export async function protectStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  // Remove credentials left by development builds of the retired adapter.
  await Promise.all([
    chrome.storage.local.remove(['githubConfig', 'githubToken']),
    chrome.storage.session.remove('githubToken'),
  ]);
}
export async function readConfig() {
  const { companionEnabled } = await chrome.storage.local.get('companionEnabled');
  return { companionEnabled: companionEnabled === true };
}
