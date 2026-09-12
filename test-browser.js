// Playwright 冒烟测试：真实浏览器验证主要流程
// 运行：npm install && npx playwright install chromium && node test-browser.js
// 自包含：内置静态服务器，不依赖外部服务或固定目录。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('未找到 playwright 依赖，请先运行：\n  npm install\n  npx playwright install chromium');
  process.exit(1);
}

// ---------- 启动前预检：浏览器二进制 + 系统运行库 ----------
const LIB_PKG = {
  'libnspr4.so': 'libnspr4', 'libnss3.so': 'libnss3', 'libnssutil3.so': 'libnss3',
  'libsmime3.so': 'libnss3', 'libssl3.so': 'libnss3', 'libplc4.so': 'libnspr4',
  'libplds4.so': 'libnspr4',
  'libatk-1.0.so.0': 'libatk1.0-0', 'libatk-bridge-2.0.so.0': 'libatk-bridge2.0-0',
  'libatspi.so.0': 'libatspi2.0-0', 'libdbus-1.so.3': 'libdbus-1-3',
  'libXcomposite.so.1': 'libxcomposite1', 'libXdamage.so.1': 'libxdamage1',
  'libXfixes.so.3': 'libxfixes3', 'libXrandr.so.2': 'libxrandr2',
  'libgbm.so.1': 'libgbm1', 'libxkbcommon.so.0': 'libxkbcommon0',
  'libasound.so.2': 'libasound2', 'libcups.so.2': 'libcups2',
  'libpango-1.0.so.0': 'libpango-1.0-0', 'libcairo.so.2': 'libcairo2',
  'libdrm.so.2': 'libdrm2', 'libwayland-server.so.0': 'libwayland-server0',
  'libXi.so.6': 'libxi6', 'libXext.so.6': 'libxext6', 'libX11.so.6': 'libx11-6',
  'libxcb.so.1': 'libxcb1', 'libexpat.so.1': 'libexpat1', 'libglib-2.0.so.0': 'libglib2.0-0',
  'libxshmfence.so.1': 'libxshmfence1', 'libX11-xcb.so.1': 'libx11-xcb1',
  'libXcursor.so.1': 'libxcursor1', 'libXss.so.1': 'libxss1', 'libXtst.so.6': 'libxtst6'
};
function reportMissingLibs(missing){
  const pkgs = [...new Set(missing.map(l => LIB_PKG[l]).filter(Boolean))];
  console.error('✗ 预检失败：Chromium 无法启动，缺少 ' + missing.length + ' 个系统运行库：');
  for (const l of missing)
    console.error('  ' + l + (LIB_PKG[l] ? '  →  Debian/Ubuntu 包 ' + LIB_PKG[l] : ''));
  console.error('\n准备命令（任选其一）：');
  console.error('  1) npx playwright install --with-deps chromium   # 需 root，自动装系统依赖');
  if (pkgs.length)
    console.error('  2) sudo apt-get install -y ' + pkgs.join(' '));
  console.error('  无 root 环境：下载对应 .deb 解压后，以 LD_LIBRARY_PATH=<解压lib目录> node test-browser.js 运行');
}
async function preflight(){
  // 1) 浏览器二进制是否存在
  let exe = null;
  try { exe = chromium.executablePath(); } catch (e) { /* 未安装 */ }
  if (!exe || !fs.existsSync(exe)){
    console.error('✗ 预检失败：未找到 Chromium 浏览器二进制。\n\n准备命令：\n  npx playwright install chromium');
    process.exit(1);
  }
  // 2) 启动冒烟测试：以真实启动结果为准（ldd 会把 dlopen 延迟加载的可选库误报为缺失）
  try {
    const b = await chromium.launch();
    await b.close();
  } catch (e) {
    const msg = String(e && e.message || e);
    const missing = [...new Set([...msg.matchAll(/error while loading shared libraries: (\S+?)(?::|$)/gm)].map(m => m[1]))];
    if (missing.length){
      reportMissingLibs(missing);
    } else {
      console.error('✗ 预检失败：Chromium 启动失败（非典型运行库缺失）。原始错误：\n' + msg.split('\n').slice(0, 12).join('\n'));
      if (process.platform === 'linux'){
        // 补充 ldd 诊断（含 dlopen 可选库，仅供参考）
        const { execSync } = require('child_process');
        let out = '';
        try { out = execSync('ldd ' + JSON.stringify(exe) + ' 2>&1').toString(); }
        catch (e2) { out = (e2.stdout || '').toString(); }
        const lddMiss = [...new Set([...out.matchAll(/^\s*(\S+)\s*=>\s*not found/gm)].map(m => m[1]))];
        if (lddMiss.length)
          console.error('\nldd 报告的未解析库（含可选库，供参考）：\n  ' + lddMiss.join('\n  '));
      }
    }
    process.exit(1);
  }
  console.log('预检通过：Chromium 可正常启动 (' + exe + ')');
}

const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.gif': 'image/gif' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()){
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let passed = 0, failed = 0;
function ok(cond, name, detail){
  if (cond){ passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
}

(async () => {
  await preflight(); // 依赖不齐时在此退出并给出准备命令，不齐绝不静默跳过
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + server.address().port + '/index.html';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // 保证可复现：无论运行环境如何，都从空存储开始（只在首次清空，后续 reload 保留数据）
  await page.goto(URL);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e){} });
  await page.reload();
  await page.waitForTimeout(300);

  console.log('\n[A] 初始加载');
  ok(await page.title() === 'Pixel Loom · 像素动画编辑器', '页面标题');
  ok(await page.locator('.frame').count() === 1, '初始 1 帧');
  ok(await page.locator('.layer').count() === 1, '初始 1 图层');
  ok(errors.length === 0, '无 JS 错误: ' + errors.join(';'));

  // 画布像素坐标（32x32，默认 zoom=14）；布局会变，每次重新取 boundingBox
  async function px(x, y){
    const box = await page.locator('#mainCanvas').boundingBox();
    return { x: box.x + (x + 0.5) * box.width / 32, y: box.y + (y + 0.5) * box.height / 32 };
  }
  async function drawPixel(x, y){
    const p = await px(x, y);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(30);
  }
  async function canvasPixel(x, y){
    return page.evaluate(([x, y]) => {
      const c = document.getElementById('mainCanvas');
      const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }, [x, y]);
  }

  console.log('\n[B] 绘制');
  await drawPixel(2, 2);
  await drawPixel(3, 2);
  let p = await canvasPixel(2, 2);
  ok(p[3] === 255, '点击绘制像素 (alpha=255)');
  ok(p[0] === 0xb1 && p[1] === 0x3e && p[2] === 0x53, '默认色 #b13e53, 实得 ' + p.slice(0, 3).join(','));
  // 拖动连续画线
  let a = await px(5, 5), b = await px(9, 5);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  p = await canvasPixel(7, 5);
  ok(p[3] === 255, '拖动连线中间像素已画');

  console.log('\n[C] 撤销/重做');
  await page.keyboard.press('Control+z'); // 撤销拖线
  p = await canvasPixel(7, 5);
  ok(p[3] === 0, 'Ctrl+Z 撤销笔画');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '上一笔保留');
  await page.keyboard.press('Control+Shift+z');
  p = await canvasPixel(7, 5);
  ok(p[3] === 255, 'Ctrl+Shift+Z 重做');

  console.log('\n[D] 帧操作');
  await page.click('#addFrameBtn');
  ok(await page.locator('.frame').count() === 2, '新增帧');
  await page.click('#dupFrameBtn');
  ok(await page.locator('.frame').count() === 3, '复制帧');
  // 回到第 1 帧（有内容）并复制
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.click('#dupFrameBtn');
  ok(await page.locator('.frame').count() === 4, '复制第 1 帧');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '复制帧携带像素');
  // 帧排序：先给当前帧（第 1 帧的复制体，索引 1）设置独特时长作为身份标记，
  // 前移后必须位于时间轴首位且身份（500ms）跟随——只改选中不交换顺序时必须失败
  await page.fill('#durInput', '500');
  await page.dispatchEvent('#durInput', 'change');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('[');
  const order = await page.evaluate(() => {
    const frames = [...document.querySelectorAll('.frame')];
    return {
      activeIdx: frames.findIndex(f => f.classList.contains('active')),
      count: frames.length,
      firstDur: frames[0].querySelector('.dur').textContent
    };
  });
  ok(order.activeIdx === 0 && order.count === 4 && order.firstDur.includes('500ms'),
    '帧前移后位于首位且帧身份跟随 (' + order.firstDur + ', activeIdx=' + order.activeIdx + ')');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '前移后当前帧内容跟随');
  // 逐帧时长
  await page.fill('#durInput', '300');
  await page.dispatchEvent('#durInput', 'change');
  const dur = await page.evaluate(() => document.querySelector('.frame.active .dur').textContent);
  ok(dur.includes('300ms'), '逐帧时长设置: ' + dur);
  // 删除帧（删除当前帧，即刚设置了 300ms 的复制体）
  const framesBefore = await page.locator('.frame').count();
  await page.click('#delFrameBtn');
  ok(await page.locator('.frame').count() === framesBefore - 1, '删除帧');

  console.log('\n[E] 图层操作');
  await page.click('#addLayerBtn');
  ok(await page.locator('.layer').count() === 2, '新增图层');
  // 在新图层画不同颜色
  await page.locator('.sw').nth(5).click(); // #ffcd75
  await drawPixel(4, 4);
  p = await canvasPixel(4, 4);
  ok(p[0] === 0xff && p[1] === 0xcd, '顶层图层绘制');
  // 显隐切换
  await page.locator('.layer').first().locator('button').first().click(); // 顶层（列表第一行=最上层）隐藏
  p = await canvasPixel(4, 4);
  ok(p[3] === 0, '隐藏图层后不显示');
  await page.locator('.layer').first().locator('button').first().click(); // 恢复显示
  p = await canvasPixel(4, 4);
  ok(p[3] === 255, '恢复显示');
  // 锁定
  await page.locator('.layer').first().locator('button').nth(1).click();
  await drawPixel(6, 6);
  p = await canvasPixel(6, 6);
  ok(p[3] === 0, '锁定图层不可绘制');
  await page.locator('.layer').first().locator('button').nth(1).click(); // 解锁
  // 图层排序
  const nameBefore = await page.locator('.layer').first().locator('.name').textContent();
  await page.click('#layerDownBtn');
  const nameAfter = await page.locator('.layer').first().locator('.name').textContent();
  ok(nameBefore !== nameAfter, '图层下移 (' + nameBefore + '→' + nameAfter + ')');
  // 移除图层
  const layersBefore = await page.locator('.layer').count();
  await page.click('#delLayerBtn');
  ok(await page.locator('.layer').count() === layersBefore - 1, '移除图层');

  console.log('\n[E2] 选区');
  // 当前：3 帧、1 图层，F1 上有像素 (2,2)(3,2)(5..9,5)
  await page.keyboard.press('m');
  ok(await page.locator('.tool[data-tool=select]').getAttribute('class').then(c => c.includes('active')), '按 M 切换选区工具');
  // 框选 (1,1)-(4,4)
  let s1 = await px(1, 1), s2 = await px(4, 4);
  await page.mouse.move(s1.x, s1.y); await page.mouse.down();
  await page.mouse.move(s2.x, s2.y, { steps: 4 }); await page.mouse.up();
  ok(await page.locator('#selOverlay').isVisible(), '拖出选区显示选框');
  // 选区存在时做其他编辑，撤销编辑不应丢选区（选区状态在快照中）
  await page.keyboard.press('b');
  await drawPixel(8, 8);
  await page.keyboard.press('Control+z'); // 撤销这一笔
  ok(await page.locator('#selOverlay').isVisible(), '撤销绘制不丢选区');
  await page.keyboard.press('m');
  // 复制 → 切到第 2 帧 → 粘贴 → Enter 贴下
  await page.keyboard.press('Control+c');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+v');
  ok(await page.locator('#selOverlay').isVisible(), '粘贴产生浮动选区');
  await page.keyboard.press('Enter');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '跨帧粘贴并贴下');
  // 撤销/重做覆盖选区操作
  await page.keyboard.press('Control+z'); // 撤销贴下
  await page.keyboard.press('Control+z'); // 撤销粘贴
  p = await canvasPixel(2, 2);
  ok(p[3] === 0, '撤销粘贴与贴下');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '重做恢复粘贴');
  // 剪切：回 F1，框选 (2,2) 单像素，Ctrl+X
  await page.keyboard.press('ArrowLeft');
  let c1 = await px(2, 2);
  await page.mouse.click(c1.x, c1.y);
  await page.keyboard.press('Control+x');
  p = await canvasPixel(2, 2);
  ok(p[3] === 0, 'Ctrl+X 剪切移除像素');
  // 跨图层粘贴：新图层贴下后，隐藏原图层像素仍在
  await page.click('#addLayerBtn');
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Enter');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '跨图层粘贴后合成可见');
  await page.locator('.layer').nth(1).locator('button').first().click(); // 隐藏底层（图层 1）
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '隐藏原图层后粘贴内容仍在（跨层一致）');
  await page.locator('.layer').nth(1).locator('button').first().click(); // 恢复显示
  // 锁定图层：贴下被阻止，浮动内容不丢失
  await page.locator('.layer').first().locator('button').nth(1).click(); // 锁定图层 2
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Enter');
  const lockMsg = await page.locator('#status').textContent();
  ok(lockMsg.includes('锁定') || lockMsg.includes('隐藏'), '锁定图层贴下被阻止: ' + lockMsg);
  ok(await page.locator('#selOverlay').isVisible(), '浮动内容保留未丢失');
  await page.locator('.layer').first().locator('button').nth(1).click(); // 解锁
  await page.keyboard.press('Enter');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '解锁后可贴下');
  // 拖动移动：先 Esc 清除旧选区，框选 (1,1)-(3,3)（含 2,2 像素），从内部拖到 (+4,+4)
  await page.keyboard.press('Escape');
  ok(!(await page.locator('#selOverlay').isVisible()), 'Esc 取消选区');
  let m1 = await px(1, 1), m2 = await px(3, 3);
  await page.mouse.move(m1.x, m1.y); await page.mouse.down();
  await page.mouse.move(m2.x, m2.y, { steps: 3 }); await page.mouse.up();
  let mv1 = await px(2, 2), mv2 = await px(6, 6);
  await page.mouse.move(mv1.x, mv1.y); await page.mouse.down();
  await page.mouse.move(mv2.x, mv2.y, { steps: 4 }); await page.mouse.up();
  p = await canvasPixel(6, 6);
  ok(p[3] === 255, '拖动移动选区内容到目标位置');
  p = await canvasPixel(2, 2);
  ok(p[3] === 0, '移动后原位置已清空');
  await page.keyboard.press('Control+z'); // 撤销移动
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '撤销移动恢复');
  await page.keyboard.press('Control+z'); // 撤销框选
  ok(!(await page.locator('#selOverlay').isVisible()), '撤销选区创建（选区变化入历史）');
  // 保存刷新：跨层粘贴结果保留
  await page.click('#saveBtn');
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(300);
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '刷新后跨层粘贴内容保留');
  ok(await page.locator('.layer').count() === 2, '刷新后图层结构保留');
  await page.keyboard.press('b'); // 回到画笔，供后续用例使用

  console.log('\n[F] 播放');
  await page.click('#playBtn');
  await page.waitForTimeout(700);
  const playInfo = await page.locator('#playInfo').textContent();
  ok(playInfo.includes('帧'), '播放中: ' + playInfo);
  const btnText = await page.locator('#playBtn').textContent();
  ok(btnText.includes('暂停'), '播放按钮切换');
  await page.click('#playBtn');
  ok((await page.locator('#playBtn').textContent()).includes('播放'), '停止播放');

  console.log('\n[G] 保存与刷新恢复');
  await drawPixel(10, 10);
  // 设置逐帧时长并应用到全部帧，用于验证时长持久化
  await page.fill('#durInput', '300');
  await page.dispatchEvent('#durInput', 'change');
  await page.click('#durAllBtn');
  await page.click('#saveBtn');
  await page.waitForTimeout(200);
  const framesN = await page.locator('.frame').count();
  const layersN = await page.locator('.layer').count();
  await page.reload();
  await page.waitForTimeout(300);
  ok(await page.locator('.frame').count() === framesN, '刷新后帧数恢复 (' + framesN + ')');
  ok(await page.locator('.layer').count() === layersN, '刷新后图层数恢复 (' + layersN + ')');
  p = await canvasPixel(10, 10);
  ok(p[3] === 255, '刷新后像素恢复');
  const durs = await page.$$eval('.frame .dur', els => els.map(e => e.textContent));
  ok(durs.length === framesN && durs.every(t => t.includes('300ms')),
    '刷新后逐帧时长恢复: [' + durs.join(' | ') + ']');

  console.log('\n[H] 导出');
  const dl1 = page.waitForEvent('download');
  await page.click('#exportPngBtn');
  const d1 = await dl1;
  ok(d1.suggestedFilename().endsWith('.png'), '导出帧 PNG: ' + d1.suggestedFilename());
  const dl2 = page.waitForEvent('download');
  await page.click('#exportSheetBtn');
  const d2 = await dl2;
  ok(d2.suggestedFilename().includes('spritesheet'), '导出精灵图');
  const dl3 = page.waitForEvent('download');
  await page.click('#exportGifBtn');
  const d3 = await dl3;
  ok(d3.suggestedFilename().endsWith('.gif'), '导出 GIF');
  // 校验 GIF 文件内容可被浏览器解码
  const path3 = await d3.path();
  const gifBuf = fs.readFileSync(path3);
  ok(gifBuf.slice(0, 6).toString() === 'GIF89a', 'GIF 文件头正确 (' + gifBuf.length + ' 字节)');
  const gifOk = await page.evaluate(async (b64) => {
    const img = new Image();
    const p = new Promise(res => { img.onload = () => res('loaded:' + img.width + 'x' + img.height); img.onerror = () => res('error'); });
    img.src = 'data:image/gif;base64,' + b64;
    return p;
  }, gifBuf.toString('base64'));
  ok(String(gifOk).startsWith('loaded:32x32'), '浏览器可解码导出的 GIF: ' + gifOk);

  console.log('\n[I] 键盘与窄屏');
  await page.keyboard.press('e'); // 橡皮
  ok(await page.locator('.tool[data-tool=eraser]').getAttribute('class').then(c => c.includes('active')), '按 E 切换橡皮');
  await page.keyboard.press('b');
  ok(await page.locator('.tool[data-tool=pencil]').getAttribute('class').then(c => c.includes('active')), '按 B 切换画笔');
  await page.keyboard.press('?');
  ok(await page.locator('#helpDialog').isVisible(), '按 ? 打开帮助');
  await page.click('#helpClose');
  // 窄屏布局
  await page.setViewportSize({ width: 480, height: 800 });
  await page.waitForTimeout(200);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ').length);
  ok(cols === 1, '窄屏单列布局');
  const stageVisible = await page.locator('#mainCanvas').isVisible();
  ok(stageVisible, '窄屏画布可见');
  // 触屏模拟绘制
  await page.touchscreen.tap(...(await page.evaluate(() => {
    const c = document.getElementById('mainCanvas');
    const r = c.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })));
  ok(errors.length === 0, '窄屏/触摸无 JS 错误: ' + errors.join(';'));

  console.log('\n[K] 边界');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);

  // K1 选区跨缩放：缩放 8 时选框位置/尺寸仍按画布坐标映射
  await page.evaluate(() => { const z = document.getElementById('zoomRange'); z.value = 8; z.dispatchEvent(new Event('input')); });
  await page.keyboard.press('m');
  await page.keyboard.press('Escape');
  let z1 = await px(3, 3), z2 = await px(6, 6);
  await page.mouse.move(z1.x, z1.y); await page.mouse.down();
  await page.mouse.move(z2.x, z2.y, { steps: 4 }); await page.mouse.up();
  const ov1 = await page.evaluate(() => { const o = document.getElementById('selOverlay'); return { left: o.style.left, top: o.style.top, width: o.style.width, height: o.style.height }; });
  ok(ov1.left === '24px' && ov1.top === '24px' && ov1.width === '32px' && ov1.height === '32px',
    '缩放=8 时选框映射正确', '期望 24px/24px/32px/32px 实得 ' + JSON.stringify(ov1));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const z = document.getElementById('zoomRange'); z.value = 14; z.dispatchEvent(new Event('input')); });

  // K2 画布边缘：拖出画布外，选区被钳制在界内
  let e1 = await px(30, 30);
  const cbox = await page.locator('#mainCanvas').boundingBox();
  await page.mouse.move(e1.x, e1.y); await page.mouse.down();
  await page.mouse.move(cbox.x + cbox.width + 60, cbox.y + cbox.height + 60, { steps: 4 });
  await page.mouse.up();
  const ov2 = await page.evaluate(() => { const o = document.getElementById('selOverlay'); return { left: o.style.left, width: o.style.width }; });
  ok(ov2.left === (30 * 14) + 'px' && ov2.width === (2 * 14) + 'px',
    '拖出画布边缘选区被钳制', '期望 left=420px width=28px 实得 ' + JSON.stringify(ov2));
  await page.keyboard.press('Escape');

  // K3 透明区域覆盖：移动含透明孔的选区，目标处已有像素不被透明覆盖
  await page.keyboard.press('b');
  await page.locator('.sw').nth(3).click();   // #b13e53
  await drawPixel(21, 21);                     // 目标像素（应保留）
  await page.locator('.sw').nth(5).click();   // #ffcd75
  await drawPixel(10, 10);                     // 源像素
  await page.keyboard.press('m');
  let t1 = await px(10, 10), t2 = await px(11, 11); // 2x2 选区，仅 (10,10) 有像素
  await page.mouse.move(t1.x, t1.y); await page.mouse.down();
  await page.mouse.move(t2.x, t2.y, { steps: 3 }); await page.mouse.up();
  let t3 = await px(10, 10), t4 = await px(20, 20); // 从选区内拖到 (+10,+10)
  await page.mouse.move(t3.x, t3.y); await page.mouse.down();
  await page.mouse.move(t4.x, t4.y, { steps: 4 }); await page.mouse.up();
  p = await canvasPixel(20, 20);
  ok(p[0] === 0xff && p[1] === 0xcd, '移动后源像素落在目标', '期望 #ffcd75 实得 ' + p.join(','));
  p = await canvasPixel(21, 21);
  ok(p[0] === 0xb1 && p[1] === 0x3e, '透明孔不覆盖目标已有像素', '期望 #b13e53 实得 ' + p.join(','));
  await page.keyboard.press('Escape');

  // K4 导出时浮动内容：未贴下直接导出，导出图应包含浮动像素
  await page.keyboard.press('b');
  await drawPixel(15, 15);
  await page.keyboard.press('m');
  let f1 = await px(15, 15);
  await page.mouse.click(f1.x, f1.y);          // 1x1 选区
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');      // 浮动，未贴下
  const dlF = page.waitForEvent('download');
  await page.click('#exportPngBtn');
  const dF = await dlF;
  const pngBuf = fs.readFileSync(await dF.path());
  const floatExported = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(60, 60, 1, 1).data; // 4x 导出 → (15*4, 15*4)
    return d[3] === 255 && d[0] === 0xff && d[1] === 0xcd;
  }, pngBuf.toString('base64'));
  ok(floatExported, '导出 PNG 包含未贴下的浮动内容（导出前自动贴下）', '期望 (60,60)=#ffcd75 不透明');
  p = await canvasPixel(15, 15);
  ok(p[3] === 255, '导出后浮动内容已贴下到画布');
  await page.keyboard.press('Escape');

  // K5 重做失效：撤销后做新编辑，重做必须清空
  await page.keyboard.press('b');
  await drawPixel(25, 25);
  await page.keyboard.press('Control+z');
  const redoAfterUndo = await page.locator('#redoBtn').isDisabled();
  ok(!redoAfterUndo, '撤销后可重做', '期望重做按钮可用');
  await drawPixel(26, 26); // 新编辑 → 重做栈失效
  ok(await page.locator('#redoBtn').isDisabled(), '新编辑后重做失效', '期望重做按钮禁用');

  // K6 损坏本地数据（写入前屏蔽 setItem，防止 beforeunload 自动保存把损坏数据覆盖回去）
  const errsK = errors.length;
  await page.evaluate(() => {
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { if (k !== 'pixelloom.project.v2') orig(k, v); };
    orig('pixelloom.project.v2', '垃圾数据{{{');
  });
  await page.reload(); await page.waitForTimeout(300);
  ok(await page.locator('.frame').count() === 1, '垃圾数据回退到新建项目', '期望 1 帧');
  ok(errors.length === errsK, '垃圾数据无 JS 错误', errors.slice(errsK).join(';'));
  // 结构合法但 cells 缺失 → 容错加载（帧结构保留，cell 补空）
  await page.evaluate(() => {
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { if (k !== 'pixelloom.project.v2') orig(k, v); };
    orig('pixelloom.project.v2', JSON.stringify({ state: JSON.stringify({ version: 2, width: 32, height: 32, nextId: 4,
      layers: [{ id: 1, name: '图层 1', visible: true, locked: false }],
      frames: [{ id: 2, duration: 100 }, { id: 3, duration: 200 }],
      cells: {}, curF: 0, curL: 0 }), settings: {} }));
  });
  await page.reload(); await page.waitForTimeout(300);
  ok(await page.locator('.frame').count() === 2, '缺失 cells 容错加载（帧结构保留）', '期望 2 帧');
  ok(errors.length === errsK, '容错加载无 JS 错误', errors.slice(errsK).join(';'));

  // K7 撤销历史上限：105 次复制帧后只能撤销 100 步
  const framesStart = await page.locator('.frame').count();
  for (let i = 0; i < 105; i++) await page.keyboard.press('d');
  ok(await page.locator('.frame').count() === framesStart + 105, '连续 105 次复制帧',
    '期望 ' + (framesStart + 105) + ' 帧');
  let undos = 0;
  for (let i = 0; i < 110; i++){
    if (await page.locator('#undoBtn').isDisabled()) break;
    await page.keyboard.press('Control+z');
    undos++;
  }
  ok(undos === 100, '撤销历史上限 100 步', '期望可撤销 100 次 实得 ' + undos);
  ok(await page.locator('#undoBtn').isDisabled(), '达到上限后撤销按钮禁用');
  ok(await page.locator('.frame').count() === framesStart + 5, '上限后保留最近 100 步状态',
    '期望 ' + (framesStart + 5) + ' 帧 实得 ' + await page.locator('.frame').count());

  console.log('\n[J] 全程无页面错误');
  ok(errors.length === 0, errors.join(';') || '无 pageerror');

  console.log(`\n浏览器测试结果：${passed} 通过, ${failed} 失败`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('测试异常:', e.message || e);
  if (/browser.*closed|Target page|SIGTRAP|SIGSEGV|error while loading/i.test(String(e)))
    console.error('提示：浏览器启动即崩溃通常是系统运行库问题，请查看上方预检输出或运行 `ldd $(npx playwright install chromium --dry-run 2>/dev/null; echo)` 排查。');
  server.close();
  process.exit(1);
});
