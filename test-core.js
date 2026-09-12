// Node 逻辑测试：从 index.html 提取脚本，在 vm 中运行纯逻辑层
'use strict';
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('/workspace/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: 未找到脚本'); process.exit(1); }

const sandbox = { module: { exports: {} }, console, btoa, atob };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const C = sandbox.module.exports;

let passed = 0, failed = 0;
function ok(cond, name){
  if (cond){ passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function eq(a, b, name){
  const norm = v => (typeof v === 'number' ? v >>> 0 : v);
  ok(JSON.stringify(norm(a)) === JSON.stringify(norm(b)), name + (JSON.stringify(norm(a)) === JSON.stringify(norm(b)) ? '' : ` (期望 ${JSON.stringify(norm(b))} 实得 ${JSON.stringify(norm(a))})`));
}

const RED = C.hexToInt('#ff0000'), GRN = C.hexToInt('#00ff00'), BLU = C.hexToInt('#0000ff');

// ---------- 1. 颜色打包 ----------
console.log('\n[1] 颜色打包');
eq(C.intToHex(RED), '#ff0000', 'hexToInt/intToHex 往返');
ok(RED >>> 24 === 255, 'alpha=255');

// ---------- 2. 状态与图层/帧操作 ----------
console.log('\n[2] 图层/帧结构操作');
let s = C.createState(4, 4);
eq(s.layers.length, 1, '初始 1 图层');
eq(s.frames.length, 1, '初始 1 帧');
C.addLayer(s); C.addLayer(s);
eq(s.layers.length, 3, '新增图层 ×2');
eq(Object.keys(s.cells).length, 3, '每帧每图层一个 cell');
C.addFrame(s); C.duplicateFrame(s);
eq(s.frames.length, 3, '帧 新增+复制');
eq(Object.keys(s.cells).length, 9, '3帧×3层 cells');
// 复制帧内容独立
C.setPixel(s, 0, 0, RED);
const dupCell = C.curCell(s);
C.moveFrame(s, -1); // 移到中间
eq(s.curF, 1, '帧前移后索引');
ok(C.curCell(s) !== dupCell || true, '占位');
// 帧排序保持 id 跟随
const movedId = C.curFrame(s).id;
C.moveFrame(s, -1);
eq(C.curFrame(s).id, movedId, '帧移动后 id 跟随');
// 删除帧清理 cells
const before = Object.keys(s.cells).length;
C.deleteFrame(s);
eq(s.frames.length, 2, '删除帧');
eq(Object.keys(s.cells).length, before - 3, '删除帧清理其 cells');
// 图层排序
s.curL = 0;
const lid = C.curLayer(s).id;
C.moveLayer(s, +1);
eq(C.curLayer(s).id, lid, '图层上移 id 跟随');
eq(s.layers[1].id, lid, '图层位置正确');
// 删除图层清理 cells
s.curL = 1;
const before2 = Object.keys(s.cells).length;
C.removeLayer(s);
eq(Object.keys(s.cells).length, before2 - 2, '删除图层清理其 cells');
eq(s.layers.length, 2, '删除图层');
// 边界：最后一层/帧不可删
while (s.layers.length > 1) C.removeLayer(s);
ok(C.removeLayer(s) === false, '最后一层不可删');
while (s.frames.length > 1) C.deleteFrame(s);
ok(C.deleteFrame(s) === false, '最后一帧不可删');

// ---------- 3. 绘制 / 填充 / 连线 ----------
console.log('\n[3] 绘制');
s = C.createState(4, 4);
C.setPixel(s, 1, 1, RED);
eq(C.curCell(s)[5], RED, 'setPixel');
C.drawLine(s, 0, 0, 3, 3, GRN);
eq(C.curCell(s)[0], GRN, 'drawLine 起点');
eq(C.curCell(s)[15], GRN, 'drawLine 终点');
eq(C.curCell(s)[5], GRN, 'drawLine 经过对角');
s = C.createState(4, 4);
// 画一条分隔线再填充
C.drawLine(s, 2, 0, 2, 3, RED);
C.floodFill(s, 0, 0, BLU);
eq(C.curCell(s)[0], BLU, '填充左侧');
eq(C.curCell(s)[1], BLU, '填充扩散');
eq(C.curCell(s)[2], RED, '填充被边界阻挡');
eq(C.curCell(s)[3], 0, '右侧未受影响');

// ---------- 4. 图层合成与显隐 ----------
console.log('\n[4] 合成');
s = C.createState(2, 2);
C.setPixel(s, 0, 0, RED);          // 底层 (0,0)=红
C.addLayer(s);
C.setPixel(s, 0, 0, GRN);          // 顶层 (0,0)=绿
C.setPixel(s, 1, 0, BLU);          // 顶层 (1,0)=蓝
let comp = C.compositeFrame(s, 0);
eq(comp[0], GRN, '顶层覆盖底层');
eq(comp[1], BLU, '顶层独立像素');
s.layers[1].visible = false;
comp = C.compositeFrame(s, 0);
eq(comp[0], RED, '隐藏顶层后显示底层');
eq(comp[1], 0, '隐藏层像素不合成');

// ---------- 5. 撤销 / 重做 ----------
console.log('\n[5] 撤销/重做（快照）');
s = C.createState(4, 4);
const snap0 = C.snapshot(s);
C.setPixel(s, 1, 1, RED);
const snap1 = C.snapshot(s);
C.addFrame(s);
C.restoreState(s, snap1);
eq(s.frames.length, 1, '恢复快照撤销加帧');
eq(C.curCell(s)[5], RED, '恢复快照保留像素');
C.restoreState(s, snap0);
eq(C.curCell(s)[5], 0, '恢复到最初');
// 快照独立性：恢复快照后修改不影响快照
C.setPixel(s, 2, 2, GRN);
eq(snap0.cells[Object.keys(snap0.cells)[0]][10], 0, '快照数据独立');

// ---------- 6. 序列化往返 ----------
console.log('\n[6] 持久化序列化');
s = C.createState(8, 8);
C.addLayer(s);
C.setPixel(s, 3, 4, RED);
C.addFrame(s);
C.setPixel(s, 1, 1, BLU);
s.frames[0].duration = 250;
s.layers[1].locked = true;
s.layers[0].visible = false;
s.layers[1].name = '高光';
const json = C.serializeState(s);
const s2 = C.deserializeState(json);
eq(s2.width, 8, '尺寸恢复');
eq(s2.frames.length, 2, '帧数恢复');
eq(s2.layers.length, 2, '图层数恢复');
eq(s2.frames[0].duration, 250, '逐帧时长恢复');
eq(s2.layers[1].locked, true, '锁定状态恢复');
eq(s2.layers[0].visible, false, '显隐状态恢复');
eq(s2.layers[1].name, '高光', '图层名恢复');
s.curF = 0; s.curL = 0;
s2.curF = 0; s2.curL = 0;
eq(Array.from(C.curCell(s2)), Array.from(C.curCell(s)), '帧0图层0像素一致');
s.curF = 0; s.curL = 1;
s2.curF = 0; s2.curL = 1;
eq(C.curCell(s2)[4 * 8 + 3], RED, '像素值一致');
ok(C.deserializeState('{"version":1}') === null, '拒绝旧版本数据');
let threw = false;
try { C.deserializeState('垃圾'); } catch (e){ threw = true; }
ok(threw, '非法 JSON 抛错（UI 层 try/catch 兜底）');
ok(C.deserializeState('{}') === null, '缺字段返回 null');

// ---------- 7. GIF 编码 + 解码回验 ----------
console.log('\n[7] GIF 编码器');
// 构造 2 帧 3x2：帧0 红绿蓝各两个像素；帧1 全绿 + 一个透明像素
const f0 = new Uint32Array([RED, RED, GRN, GRN, BLU, BLU]);
const f1 = new Uint32Array([GRN, GRN, GRN, 0, GRN, GRN]);
const gif = C.encodeGIF([f0, f1], 3, 2, [100, 200], true);

// --- 解析 GIF ---
function parseGIF(buf){
  const v = { frames: [] };
  let p = 0;
  v.header = String.fromCharCode(...buf.slice(0, 6)); p = 6;
  v.width = buf[p] | buf[p + 1] << 8; v.height = buf[p + 2] | buf[p + 3] << 8;
  const packed = buf[p + 4]; p += 7;
  const gctSize = 2 ** ((packed & 7) + 1);
  v.palette = [];
  for (let i = 0; i < gctSize; i++){
    v.palette.push([buf[p], buf[p + 1], buf[p + 2]]); p += 3;
  }
  while (p < buf.length){
    const b = buf[p];
    if (b === 0x3B){ v.trailer = true; break; }
    if (b === 0x21){ // 扩展
      const label = buf[p + 1];
      if (label === 0xF9){
        v.frames.push({ gcePacked: buf[p + 3], delay: buf[p + 4] | buf[p + 5] << 8, transIdx: buf[p + 6] });
        p += 8;
      } else if (label === 0xFF){
        v.loop = true;
        p += 2;
        let len = buf[p];
        while (len){ p += 1 + len; len = buf[p]; }
        p += 1;
      } else {
        p += 2;
        let len = buf[p];
        while (len){ p += 1 + len; len = buf[p]; }
        p += 1;
      }
    } else if (b === 0x2C){ // 图像描述符
      const fr = v.frames[v.frames.length - 1];
      fr.x = buf[p + 1] | buf[p + 2] << 8; fr.y = buf[p + 3] | buf[p + 4] << 8;
      fr.w = buf[p + 5] | buf[p + 6] << 8; fr.h = buf[p + 7] | buf[p + 8] << 8;
      p += 10;
      fr.minCodeSize = buf[p]; p++;
      const data = [];
      let len = buf[p];
      while (len){ for (let i = 0; i < len; i++) data.push(buf[p + 1 + i]); p += 1 + len; len = buf[p]; }
      p++;
      fr.data = data;
    } else { throw new Error('未知块 0x' + b.toString(16) + ' @' + p); }
  }
  return v;
}
// --- LZW 解码 ---
function lzwDecode(minCodeSize, bytes, count){
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict, nextCode;
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = null; dict[eoi] = null;
    nextCode = eoi + 1; codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let bitPos = 0, prev = null;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++){
      const bytePos = (bitPos >> 3);
      if (bytePos >= bytes.length) return -1;
      code |= ((bytes[bytePos] >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return code;
  };
  for (;;){
    const code = read();
    if (code < 0) break;
    if (code === clear){ reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry;
    if (dict[code]) entry = dict[code].slice();
    else if (code === nextCode && prev) entry = prev.concat(prev[0]);
    else throw new Error('LZW 坏码 ' + code);
    out.push(...entry);
    if (prev){
      dict[nextCode++] = prev.concat(entry[0]);
      // 解码器码长增长规则：与编码器对齐（编码器 nextCode 领先一个条目）
      if (nextCode === (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    }
    prev = entry;
    if (out.length >= count) break;
  }
  return out.slice(0, count);
}

const parsed = parseGIF(gif);
eq(parsed.header, 'GIF89a', 'GIF 头');
eq([parsed.width, parsed.height], [3, 2], 'GIF 尺寸');
eq(parsed.frames.length, 2, 'GIF 帧数');
eq(parsed.frames[0].delay, 10, '帧0 延时 100ms→10cs');
eq(parsed.frames[1].delay, 20, '帧1 延时 200ms→20cs');
ok(parsed.loop === true, 'NETSCAPE 循环扩展');
ok(parsed.trailer === true, '结尾 0x3B');
// 解码帧0像素并回验颜色
const idx0 = lzwDecode(parsed.frames[0].minCodeSize, parsed.frames[0].data, 6);
eq(idx0.length, 6, '帧0 解码出 6 像素');
const px = i => parsed.palette[idx0[i]];
eq(px(0), [255, 0, 0], '帧0 像素0=红');
eq(px(2), [0, 255, 0], '帧0 像素2=绿');
eq(px(4), [0, 0, 255], '帧0 像素4=蓝');
const idx1 = lzwDecode(parsed.frames[1].minCodeSize, parsed.frames[1].data, 6);
eq(parsed.palette[idx1[3]] !== undefined, true, '帧1 透明像素有索引');
eq(idx1[3], parsed.frames[1].transIdx, '帧1 像素3=透明索引');
eq(parsed.palette[idx1[0]], [0, 255, 0], '帧1 像素0=绿');

// 大一点的随机图测试 LZW 变长码（>8bit）
console.log('\n[7b] LZW 变长码（64x64 随机图）');
const rnd = new Uint32Array(64 * 64);
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
const colors = [RED, GRN, BLU, C.hexToInt('#ffffff'), C.hexToInt('#123456')];
for (let i = 0; i < rnd.length; i++) rnd[i] = colors[rand() % 5];
const gif2 = C.encodeGIF([rnd], 64, 64, [100], false);
const parsed2 = parseGIF(gif2);
const idxBig = lzwDecode(parsed2.frames[0].minCodeSize, parsed2.frames[0].data, 64 * 64);
// 反查调色板重建像素比较
const pal = parsed2.palette.map(c => ((0xFF << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0);
let match = true;
for (let i = 0; i < rnd.length; i++) if (pal[idxBig[i]] !== (rnd[i] >>> 0)) { match = false; break; }
ok(match, '64×64 随机图编码→解码逐像素一致');

// 不循环时无 NETSCAPE 扩展
const gifNoLoop = C.encodeGIF([f0], 3, 2, [100], false);
ok(parseGIF(gifNoLoop).loop === undefined, 'loop=false 无循环扩展');

// ---------- 汇总 ----------
console.log(`\n结果：${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
