import { t } from './lib/i18n.js';
import { installTheme } from './lib/theme.js';
await installTheme();
const nonce = new URLSearchParams(location.search).get('request'),
  status = document.getElementById('microphone-status'),
  allow = document.getElementById('allow-microphone');
const key = /^[a-f0-9-]{36}$/.test(nonce || '') ? `microphone:${nonce}` : null;
async function result(value) {
  if (key) await chrome.storage.session.set({ [key]: value });
}
allow.addEventListener('click', async () => {
  allow.disabled = true;
  status.className = '';
  status.textContent = t('请在浏览器弹出的麦克风权限提示中选择“允许”…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = t('麦克风已允许，可以返回插件录音。');
    await result({ ok: true });
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    status.className = 'error-text';
    status.textContent =
      error.name === 'NotAllowedError'
        ? t(
            '麦克风权限被阻止。请打开浏览器麦克风设置允许访问，并检查系统是否允许浏览器使用麦克风，再重试。',
          )
        : error.name === 'NotFoundError'
          ? t('没有找到麦克风，请连接设备后重试。')
          : t('无法使用麦克风，请检查设备是否被其他程序占用。');
    await result({ ok: false, error: status.textContent });
  } finally {
    allow.disabled = false;
  }
});
document.getElementById('cancel-microphone').addEventListener('click', async () => {
  await result({ ok: false, error: t('已取消麦克风授权，录音没有开始。') });
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) await chrome.tabs.remove(tab.id);
});
document
  .getElementById('microphone-settings')
  .addEventListener('click', () =>
    chrome.tabs.create({ url: 'chrome://settings/content/microphone' }),
  );
