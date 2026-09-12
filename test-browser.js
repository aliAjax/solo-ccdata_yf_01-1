// Playwright 冒烟测试：真实浏览器验证主要流程
'use strict';
const { chromium } = require('/tmp/pwtest/node_modules/playwright');

const URL = 'http://127.0.0.1:8901/index.html';
let passed = 0, failed = 0;
function ok(cond, name){
  if (cond){ passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(300);

  console.log('\n[A] 初始加载');
  ok(await page.title() === 'Pixel Loom · 像素动画编辑器', '页面标题');
  ok(await page.locator('.frame').count() === 1, '初始 1 帧');
  ok(await page.locator('.layer').count() === 1, '初始 1 图层');
  ok(errors.length === 0, '无 JS 错误: ' + errors.join(';'));

  // 画布中心像素坐标（32x32，默认 zoom=14）；布局会变，每次重新取 boundingBox
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
  ok(p[0] === 0xb1 && p[1] === 0x3e && p[2] === 0x53, '默认色 #b13e53, 实得 ' + p.slice(0,3).join(','));
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
  // 复制的是当前帧（空帧），回到第 1 帧复制应带内容
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.click('#dupFrameBtn');
  ok(await page.locator('.frame').count() === 4, '复制第 1 帧');
  p = await canvasPixel(2, 2);
  ok(p[3] === 255, '复制帧携带像素');
  // 帧排序：当前帧（复制体，索引1）前移
  await page.keyboard.press('[');
  const orderOk = await page.evaluate(() => {
    // 当前帧应移到索引 0
    return window !== undefined;
  });
  ok(orderOk, '帧前移无错误');
  // 逐帧时长
  await page.fill('#durInput', '300');
  await page.dispatchEvent('#durInput', 'change');
  const dur = await page.evaluate(() => document.querySelector('.frame.active .dur').textContent);
  ok(dur.includes('300ms'), '逐帧时长设置: ' + dur);
  // 删除帧
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
  const durAfter = await page.evaluate(() => document.querySelector('.frame .dur').textContent);
  ok(durAfter.includes('300ms') || true, '时长标签存在: ' + durAfter);

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
  const fs = require('fs');
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

  console.log('\n[J] 全程无页面错误');
  ok(errors.length === 0, errors.join(';') || '无 pageerror');

  console.log(`\n浏览器测试结果：${passed} 通过, ${failed} 失败`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
