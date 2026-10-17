export async function ensureMicrophonePermission({ signal, onStatus = () => {} } = {}) {
  let permission;
  try {
    permission = await navigator.permissions.query({ name: 'microphone' });
  } catch {}
  if (permission?.state === 'granted') return;
  onStatus('已打开麦克风授权页，请点击“允许麦克风”。');
  const nonce = crypto.randomUUID(),
    key = `microphone:${nonce}`;
  let tab;
  return new Promise((resolve, reject) => {
    let finished = false;
    function finish(result, close = false) {
      if (finished) return;
      finished = true;
      chrome.storage.onChanged.removeListener(changed);
      chrome.tabs.onRemoved.removeListener(removed);
      chrome.tabs.onUpdated.removeListener(navigated);
      signal?.removeEventListener('abort', abort);
      chrome.storage.session.remove(key).catch(() => {});
      if (close && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
      result.ok ? resolve() : reject(new Error(result.error || '麦克风未授权，录音没有开始。'));
    }
    function changed(changes, area) {
      if (area === 'session' && changes[key]?.newValue)
        finish(changes[key].newValue, changes[key].newValue.ok);
    }
    async function removed(id) {
      if (id === tab?.id) {
        const value = (await chrome.storage.session.get(key))[key];
        finish(value || { ok: false, error: '麦克风授权页已关闭，录音没有开始。' });
      }
    }
    function navigated(id, info) {
      if (
        id === tab?.id &&
        info.url &&
        info.url !== chrome.runtime.getURL(`microphone.html?request=${nonce}`)
      )
        finish({ ok: false, error: '麦克风授权页已离开，录音没有开始。' });
    }
    function abort() {
      finish({ ok: false, error: '录音操作已取消。' }, true);
    }
    chrome.storage.onChanged.addListener(changed);
    chrome.tabs.onRemoved.addListener(removed);
    chrome.tabs.onUpdated.addListener(navigated);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    chrome.tabs
      .create({ url: chrome.runtime.getURL(`microphone.html?request=${nonce}`), active: true })
      .then((value) => {
        tab = value;
        if (finished) chrome.tabs.remove(tab.id).catch(() => {});
      })
      .catch((error) => finish({ ok: false, error: error.message }));
  });
}
