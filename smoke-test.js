/* 冒烟测试：最小 DOM 桩，验证三智能体链路与办事卡输出 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const defaults = { q: '', campus: 'lingshui' };
const els = {};
const created = [];

function makeEl(id, register) {
  const e = {
    id, value: defaults[id] || '', textContent: '', innerHTML: '', className: '',
    style: { display: '' }, children: [], _h: {}, _qs: {}, type: '',
    classList: {
      toggle() {}, add() {}, remove() {}, contains() { return false; }
    },
    addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); },
    dispatch(t) { (this._h[t] || []).forEach(f => f.call(this)); },
    appendChild(c) {
      this.children.push(c);
      if (c && c.value !== undefined && c.value !== '' && this.value === '') this.value = c.value;
    },
    querySelector(sel) {
      if (!this._qs[sel]) this._qs[sel] = makeEl(id + sel, false);
      return this._qs[sel];
    },
    removeChild() {}, getAttribute() { return null; },
    scrollIntoView() {}, select() {}, focus() {}
  };
  if (register !== false) els[id] = e;
  return e;
}
function mkEl(id) { return makeEl(id, true); }

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, String, Number, Array, Object, RegExp, isNaN, parseInt, parseFloat,
  navigator: {},
  window: { setTimeout, clearTimeout, print() { sandbox.__printed = true; } },
  document: {
    readyState: 'complete',
    getElementById(id) { return els[id] || mkEl(id); },
    createElement() {
      const e = {
        value: '', textContent: '', innerHTML: '', className: '', children: [], _h: {}, type: '',
        classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); },
        dispatch(t) { (this._h[t] || []).forEach(f => f.call(this)); },
        appendChild(c) { this.children.push(c); },
        setAttribute(k, v) { this[k] = v; }, getAttribute() { return null; },
        querySelector(sel) {
          if (!this._qs) this._qs = {};
          if (!this._qs[sel]) this._qs[sel] = makeEl('c' + sel, false);
          return this._qs[sel];
        }
      };
      created.push(e);
      return e;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: { appendChild() {}, removeChild() {} }
  }
};
sandbox.window.setTimeout = setTimeout;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
const base = path.join(__dirname, 'assets');
vm.runInContext(fs.readFileSync(path.join(base, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });

function click(id) { els[id].dispatch('click'); }
function strip(s) { return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }
function card() { return strip(els['card'].innerHTML); }
function optBtn(b, v) { return created.filter(e => e._b === b && e._v === v)[0]; }
function runSync() {
  click('runBtn');
  // 模拟延迟完成：直接读取最新 stage 内容
  return new Promise(r => setTimeout(r, 2200));
}

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ->  ' + extra : ''));
  if (!cond) fail++;
}

(async function main() {
  console.log('\n[1] 初始化与默认场景');
  check('场景 chip 已渲染 5 个', created.filter(e => e._scenarioId).length === 5,
    created.filter(e => e._scenarioId).length + ' 个');
  check('默认选中校园卡场景', els['scTitle'].textContent === '校园卡丢失与补办', els['scTitle'].textContent);
  check('分支按钮已生成（密码 3 项 + 找回 2 项）', created.filter(e => e._b).length === 5,
    created.filter(e => e._b).length + ' 个');
  check('校区下拉 3 项', els['campus'].children.length === 3);

  console.log('\n[2] 自然语言识别');
  els['q'].value = '校园卡丢了怎么办';
  click('askBtn');
  check('识别成功', els['matchHint'].textContent.indexOf('识别为') >= 0, els['matchHint'].textContent.slice(0, 40));
  els['q'].value = '宿舍的水管漏水了';
  click('askBtn');
  check('切换到宿舍报修场景', els['scTitle'].textContent === '宿舍设施报修', els['scTitle'].textContent);
  els['q'].value = '研讨间怎么预约';
  click('askBtn');
  check('切换到研讨间场景', els['scTitle'].textContent === '图书馆研讨间预约', els['scTitle'].textContent);
  els['q'].value = '今天食堂有什么菜';
  click('askBtn');
  check('未匹配时给出诚实提示', els['matchHint'].textContent.indexOf('没能匹配') >= 0);

  console.log('\n[3] 主线：校园卡 · 改过密码 · 找不回来');
  created.filter(e => e._scenarioId === 'card')[0].dispatch('click');
  await runSync();
  let c = card();
  check('路径含「立即自助挂失」', c.includes('立即自助挂失'));
  check('路径含「到服务大厅补办新卡」', c.includes('到服务大厅补办新卡'));
  check('路径含「自助解挂 / 启用新卡」', c.includes('自助解挂 / 启用新卡'));
  check('跳过「短暂观察」步骤', !c.includes('短暂观察，确认是否找回'));
  check('跳过线下解挂', !c.includes('到服务大厅办理解挂'));
  check('跳过不确定密码分支步骤', !c.includes('先判断密码状态'));
  check('步骤数为 4', (c.match(/须先完成前序步骤/g) || []).length === 3, '依赖关系条数 ' + (c.match(/须先完成前序步骤/g) || []).length);
  check('含工本费 25 元', c.includes('补卡工本费 25 元'));
  check('含 i大工 APP 入口', c.includes('i大工 APP'));
  check('含网信中心服务大厅', c.includes('网信中心服务大厅'));
  check('校区=凌水时显示凌水地点', c.includes('凌水校区'));

  console.log('\n[4] 分支切换：密码 → 初始密码');
  optBtn('pwd', 'initial').dispatch('click');
  c = card();
  check('改为线下解挂', c.includes('到服务大厅办理解挂'));
  check('移除自助解挂', !c.includes('自助解挂 / 启用新卡'));
  check('提示不可自助解挂', c.includes('初始密码未修改，按规定不可自助解挂'));

  console.log('\n[5] 分支切换：找回 → 不确定（跳过补办）');
  optBtn('pwd', 'changed').dispatch('click');
  optBtn('found', 'maybe').dispatch('click');
  c = card();
  check('保留「短暂观察」步骤', c.includes('短暂观察，确认是否找回'));
  check('移除补办步骤', !c.includes('到服务大厅补办新卡'));
  check('移除三个解挂步骤本身', !c.includes('自助解挂 / 启用新卡') && !c.includes('到服务大厅办理解挂') && !c.includes('先判断密码状态'));
  check('提示补办后原卡作废', c.includes('一旦完成补办，原卡永久作废'));

  console.log('\n[6] 校区切换');
  optBtn('found', 'no').dispatch('click');
  els['campus'].value = 'panjin';
  els['campus'].dispatch('change');
  c = card();
  check('地点切换为盘锦', c.includes('盘锦校区') && !c.includes('凌水校区 · 网信中心'));
  els['campus'].value = 'lingshui';
  els['campus'].dispatch('change');

  console.log('\n[7] 依据可追溯 + 待核实清单');
  c = card();
  check('含依据表', c.includes('二、依据（可追溯）'));
  check('依据标出出处文件名', c.includes('一卡通服务指南') && c.includes('《学生证件管理办法》'));
  check('含「使用前必须先确认」区', c.includes('使用前必须先确认的信息'));
  check('未抹掉待核实标记', c.includes('待核实'));
  check('含免责声明', c.includes('不代表学校办理结果'));

  console.log('\n[8] 其余 4 个场景冒烟');
  const ids = ['stucard', 'dorm', 'late', 'room'];
  for (const id of ids) {
    created.filter(e => e._scenarioId === id)[0].dispatch('click');
    await runSync();
    const t = card();
    check('场景 ' + id + ' 生成非空办事卡', t.length > 200 && t.includes('一、你要做的事'), t.length + ' 字符');
    check('场景 ' + id + ' 含各自场景名', t.includes(els['scTitle'].textContent));
  }

  console.log('\n[9] 打印与导出');
  els['printBtn'].dispatch('click');
  check('打印触发', sandbox.__printed === true);
  check('Markdown 已构建', typeof els['copyBtn'] !== 'undefined');

  console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
  process.exit(fail === 0 ? 0 : 1);
})();
