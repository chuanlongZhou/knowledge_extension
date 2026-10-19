import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserOptions } from '../../tests/browser-options.mjs';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, kind, width, height] of [
    ['small-440x280', 'small', 440, 280],
    ['marquee-1400x560', 'marquee', 1400, 560],
  ]) {
    const dir = path.join(base, 'assets', 'promotional');
    await mkdir(dir, { recursive: true });
    await page.setViewportSize({ width, height });
    await page.goto(pathToFileURL(path.join(base, 'source/design.html')).href + '?kind=' + kind);
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await page.screenshot({
      path: path.join(dir, name + '.png'),
      animations: 'disabled',
    });
    console.log(`PASS ${name}: ${width}×${height}`);
  }
  const localeHeadings = {
    'zh-CN': ['名称', '简短描述', '宣传标题', '详细介绍', '五张截图的说明文字'],
    en: [
      'Name',
      'Short description',
      'Campaign headline',
      'Detailed description',
      'Screenshot captions',
    ],
    fr: ['Nom', 'Description courte', 'Accroche', 'Description détaillée', 'Légendes des captures'],
    ja: ['名前', '短い説明', 'キャッチコピー', '詳しい説明', 'スクリーンショットの説明'],
  };
  const data = { product: 'GUGA Knowledge', version: '0.9.1', locales: {} };
  for (const [locale, headings] of Object.entries(localeHeadings)) {
    const text = await readFile(path.join(base, 'copy', locale + '.md'), 'utf8');
    const section = (heading) =>
      text
        .split('## ' + heading + '\n')[1]
        ?.split('\n## ')[0]
        .trim();
    const [name, shortDescription, headline, description, captions] = headings.map(section);
    if (!name || !description || !shortDescription || [...shortDescription].length > 132)
      throw Error('Incomplete listing: ' + locale);
    data.locales[locale] = {
      name,
      shortDescription,
      headline,
      tagline: 'YOUR KNOWLEDGE, GUGUGAGA',
      description,
      screenshotCaptions: captions.split('\n').map((line) => line.replace(/^\d+\. /, '')),
    };
    await writeFile(path.join(base, 'copy', locale + '-description.txt'), description + '\n');
  }
  await writeFile(path.join(base, 'listing-fields.json'), JSON.stringify(data, null, 2));
  const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const screenshots = (await readdir(path.join(base, 'assets/screenshots/zh-CN')))
    .filter((n) => n.endsWith('.png'))
    .sort();
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>GUGA Knowledge · 上架素材</title><style>*{box-sizing:border-box}body{margin:0;padding:48px;background:#f5f4f0;color:#25332f;font-family:'Segoe UI','Microsoft YaHei',sans-serif}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}h1{font-size:34px;margin:0 0 8px}p{color:#66766d;margin:0;line-height:1.7}a{color:#285f49}h2{font-size:18px;margin:28px 0 14px}.top{display:grid;grid-template-columns:440px 1fr;gap:22px;align-items:center}.top img{max-width:100%;border-radius:16px}.copy{padding:22px 28px;border:1px solid #dce1d8;border-radius:16px;line-height:1.9;background:white}.marquee{width:100%;border-radius:16px;margin-top:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.grid figure{margin:0;background:white;border:1px solid #dce1d8;border-radius:12px;overflow:hidden}.grid img{width:100%;display:block}.grid figcaption{padding:12px 16px;font-size:14px}.icons{display:flex;align-items:center;gap:22px}.icons div{background:white;border:1px solid #dce1d8;border-radius:16px;padding:12px}.icons img{width:80px;height:80px}.foot{font-size:12px;margin-top:30px}</style><header><div><h1>GUGA Knowledge</h1><p>上线文案与图片 · v0.9.1 · 中文 / English / Français / 日本語</p></div><div class="icons"><div><img src="assets/icons/current-icon-128.png" alt="当前插件图标"></div></div></header><div class="top"><img src="assets/promotional/small-440x280.png" alt="小宣传图"><div class="copy"><strong>${esc(data.locales['zh-CN'].headline)}</strong><p>${esc(data.locales['zh-CN'].shortDescription)}</p><p>四种语言的完整介绍、各五张真实截图、通用宣传图、图标与可编辑源文件。</p><a href="README.md">查看文件说明</a> · <a href="listing-fields.json">查看可复制字段</a></div></div><img class="marquee" src="assets/promotional/marquee-1400x560.png" alt="品牌横幅"><h2>真实界面 · 中文预览</h2><div class="grid">${screenshots.map((name, i) => `<figure><img src="assets/screenshots/zh-CN/${name}" alt="${esc(data.locales['zh-CN'].screenshotCaptions[i])}"><figcaption>${esc(data.locales['zh-CN'].screenshotCaptions[i])}</figcaption></figure>`).join('')}</div><p class="foot">界面录制使用隔离的示例资料库。界面、图标与宣传图统一沿用最早的灰色企鹅。宣传图为通用素材，截图可按语言上传。</p></html>`;
  const picker =
    '<label style="float:right;font-size:14px;font-weight:400">截图语言 <select id="preview-language" style="padding:6px 12px;border:1px solid #ccd6cb;border-radius:8px;background:white"><option value="zh-CN">中文</option><option value="en">English</option><option value="fr">Français</option><option value="ja">日本語</option></select></label>';
  const previewScript =
    'const DATA=' +
    JSON.stringify(data).replaceAll('<', '\\u003c') +
    ';const SHOTS=' +
    JSON.stringify(screenshots) +
    ';document.getElementById("preview-language").addEventListener("change",function(){const locale=this.value,d=DATA.locales[locale];document.documentElement.lang=locale;document.querySelector(".copy strong").textContent=d.headline;document.querySelector(".copy p").textContent=d.shortDescription;document.querySelectorAll(".grid figure").forEach((figure,i)=>{figure.querySelector("img").src="assets/screenshots/"+locale+"/"+SHOTS[i];figure.querySelector("img").alt=d.screenshotCaptions[i];figure.querySelector("figcaption").textContent=d.screenshotCaptions[i];});});';
  const previewHtml = html
    .replace('<h2>真实界面 · 中文预览</h2>', '<h2>真实界面' + picker + '</h2>')
    .replace('</html>', '<script>' + previewScript + '</script></html>');
  await writeFile(path.join(base, 'preview.html'), previewHtml);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(pathToFileURL(path.join(base, 'preview.html')).href);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await page.screenshot({
    path: path.join(base, 'preview.png'),
    fullPage: true,
    animations: 'disabled',
  });
} finally {
  await browser.close();
}
