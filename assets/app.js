/* 理小办 · 三智能体接力演示引擎
 * 纯前端确定性推理，不调用任何外部接口、不联网、可离线运行。
 * 三个智能体职责严格分离：信息（只查）/ 规划（只排）/ 执行（只填）。
 */
(function () {
  'use strict';

  var S = LXB.scenarios;
  var state = { scenario: null, answers: {}, campus: 'lingshui', plan: null, timer: [], chips: [], opts: [], cardText: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function arr(a) { return Array.isArray(a) ? a : (a ? [a] : []); }
  function resolveCampus(v, cid) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    return v[cid] || v.default || '';
  }
  function campusName(cid) {
    for (var i = 0; i < LXB.campuses.length; i++) if (LXB.campuses[i].id === cid) return LXB.campuses[i].name;
    return cid;
  }
  function optionLabel(sc, bid, val) {
    var b = null;
    sc.branches.forEach(function (x) { if (x.id === bid) b = x; });
    if (!b) return val;
    for (var i = 0; i < b.options.length; i++) if (b.options[i].v === val) return b.options[i].label;
    return val;
  }

  /* ---------- 触发匹配 ---------- */
  function matchScenario(q) {
    q = String(q || '').trim();
    if (!q) return null;
    var best = null, bestScore = 0;
    S.forEach(function (sc) {
      var score = 0;
      sc.triggers.forEach(function (t) { if (q.indexOf(t) >= 0) score += t.length; });
      if (q.length > 3 && sc.name.indexOf(q) >= 0) score += 10;
      if (score > bestScore) { bestScore = score; best = sc; }
    });
    return best;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    var cs = $('campus');
    LXB.campuses.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      cs.appendChild(o);
    });
    cs.value = 'lingshui';
    cs.addEventListener('change', function () {
      state.campus = cs.value;
      if (state.plan) renderCardOnly();
    });

    var wrap = $('chips');
    S.forEach(function (sc) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = sc.icon + ' · ' + sc.name;
      b._scenarioId = sc.id;
      b.addEventListener('click', function () { pickScenario(sc.id); });
      wrap.appendChild(b);
      state.chips.push(b);
    });

    $('askBtn').addEventListener('click', ask);
    $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); });
    $('runBtn').addEventListener('click', run);
    $('copyBtn').addEventListener('click', copyCard);
    $('printBtn').addEventListener('click', function () { window.print(); });

    renderMigrate();
    renderMetrics();
    renderScenarioLib();
    pickScenario('card');
  }

  function ask() {
    var q = $('q').value;
    var sc = matchScenario(q);
    var hint = $('matchHint');
    if (!sc) {
      hint.className = 'hint no';
      hint.textContent = '没能匹配到已配置场景。可直接点上方场景按钮；正式上线后会由检索域扩展来覆盖更多问法。';
      return;
    }
    hint.className = 'hint ok';
    hint.textContent = '识别为「' + sc.name + '」——匹配依据：你提到了「' +
      (sc.triggers.filter(function (t) { return q.indexOf(t) >= 0; })[0] || sc.name) + '」';
    pickScenario(sc.id);
    window.setTimeout(run, 260);
  }

  function pickScenario(id) {
    var sc = null;
    S.forEach(function (x) { if (x.id === id) sc = x; });
    if (!sc) return;
    state.scenario = sc;
    state.answers = {};
    sc.branches.forEach(function (b) { state.answers[b.id] = b.options[0].v; });
    state.plan = null;

    state.chips.forEach(function (c) {
      var on = c._scenarioId === id;
      if (on) c.className = 'chip on'; else c.className = 'chip';
    });

    $('scTitle').textContent = sc.name;
    $('scSummary').textContent = sc.summary;

    var bw = $('branches');
    bw.innerHTML = '';
    state.opts = [];
    sc.branches.forEach(function (b) {
      var box = document.createElement('div');
      box.className = 'branch';

      var q = document.createElement('div'); q.className = 'bq'; q.textContent = b.q;
      var w = document.createElement('div'); w.className = 'bwhy'; w.textContent = b.why;
      var row = document.createElement('div'); row.className = 'bopts';

      b.options.forEach(function (o, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'opt' + (i === 0 ? ' on' : '');
        btn.textContent = o.label;
        btn._b = b.id; btn._v = o.v;
        btn.addEventListener('click', function () {
          state.opts.forEach(function (x) { if (x._b === b.id) x.className = 'opt'; });
          btn.className = 'opt on';
          state.answers[b.id] = o.v;
          if (state.plan) renderCardOnly();
        });
        row.appendChild(btn);
        state.opts.push(btn);
      });

      box.appendChild(q); box.appendChild(w); box.appendChild(row);
      bw.appendChild(box);
    });

    resetPipeline();
    $('cardWrap').style.display = 'none';
  }

  /* ---------- ② 规划：筛选与排序 ---------- */
  function plan(sc, ans) {
    var kept = {}, order = [], skipped = [];
    var sorted = sc.steps.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    function visible(step) {
      if (step.onlyIf) {
        for (var k in step.onlyIf) {
          if (step.onlyIf[k].indexOf(ans[k]) < 0) {
            skipped.push({ step: step, reason: '分支条件不满足：' + branchName(sc, k) + '＝' + optionLabel(sc, k, ans[k]) });
            return false;
          }
        }
      }
      var deps = arr(step.dependsOn);
      for (var i = 0; i < deps.length; i++) {
        if (!kept[deps[i]]) {
          skipped.push({ step: step, reason: '前置步骤「' + stepName(sc, deps[i]) + '」不在你的路径中' });
          return false;
        }
      }
      return true;
    }
    function stepName(sc, id) {
      var n = id;
      sc.steps.forEach(function (s) { if (s.id === id) n = s.name; });
      return n;
    }
    function branchName(sc, id) {
      var q = id;
      sc.branches.forEach(function (b) { if (b.id === id) q = b.q.replace(/？$/, ''); });
      return q.length > 18 ? q.slice(0, 18) + '…' : q;
    }

    sorted.forEach(function (s) {
      if (visible(s)) { kept[s.id] = true; order.push(s); }
    });

    var deps = [];
    order.forEach(function (s) {
      arr(s.dependsOn).forEach(function (d) {
        deps.push({ from: stepName(sc, d), to: s.name });
      });
    });

    return { steps: order, skipped: skipped, deps: deps };
  }

  /* ---------- 流水线运行 ---------- */
  function resetPipeline() {
    state.timer.forEach(clearTimeout);
    state.timer = [];
    ['stageInfo', 'stagePlan', 'stageExec', 'stageMerge'].forEach(function (id) {
      $(id).className = 'stage-box pending';
      $(id).querySelector('.stage-body').innerHTML = '<div class="wait">等待输入…</div>';
    });
  }

  function run() {
    var sc = state.scenario;
    if (!sc) return;
    resetPipeline();
    $('cardWrap').style.display = 'none';

    var p = plan(sc, state.answers);
    state.plan = p;

    var seq = [
      ['stageInfo', function () { return infoOut(sc); }],
      ['stagePlan', function () { return planOut(sc, p); }],
      ['stageExec', function () { return execOut(sc, p); }],
      ['stageMerge', function () { return mergeOut(sc, p); }]
    ];
    seq.forEach(function (s, i) {
      var t = window.setTimeout(function () {
        $(s[0]).className = 'stage-box done';
        $(s[0]).querySelector('.stage-body').innerHTML = s[1]();
        if (i === seq.length - 1) {
          $('cardWrap').style.display = 'block';
          renderCardOnly();
        }
      }, 420 * (i + 1));
      state.timer.push(t);
    });
  }

  /* ---------- ① 信息智能体 ---------- */
  function infoOut(sc) {
    return '<div class="s-out">' +
      '<div class="s-note">只检索并列出带出处的原始事实，<b>不推断顺序、不给建议、不填地点</b>。</div>' +
      '<table class="mini"><tr><th style="width:46%">事实</th><th>出处</th><th style="width:88px">状态</th></tr>' +
      sc.facts.map(function (f) {
        return '<tr><td>' + esc(f.t) + '</td><td class="src">' + esc(f.src) + '<br><span class="loc">' + esc(f.loc) + '</span></td>' +
          '<td>' + (f.v === 'doc' ? '<span class="tag tag-doc">文档示例</span>' : '<span class="tag tag-todo">待核实</span>') + '</td></tr>';
      }).join('') + '</table></div>';
  }

  /* ---------- ② 规划智能体 ---------- */
  function planOut(sc, p) {
    var branchLines = '';
    if (Object.keys(state.answers).length) {
      branchLines = '<div class="blk"><b>分支判定</b><ul>' +
        Object.keys(state.answers).map(function (k) {
          return '<li>' + esc(optionLabelBranch(sc, k)) + ' → <b>' + esc(optionLabel(sc, k, state.answers[k])) + '</b></li>';
        }).join('') + '</ul></div>';
    }
    return '<div class="s-out">' +
      '<div class="s-note">只判断依赖与分支、决定顺序，<b>不填写入口、地点、材料</b>。</div>' +
      branchLines +
      (p.deps.length ? '<div class="blk"><b>识别到的依赖</b><ul>' +
        p.deps.map(function (d) { return '<li><b>' + esc(d.from) + '</b> 必须在 <b>' + esc(d.to) + '</b> 之前完成</li>'; }).join('') +
        '</ul></div>' : '<div class="blk"><b>识别到的依赖</b><div class="dim">本次路径无强制前后依赖</div></div>') +
      '<div class="blk"><b>排序结果（' + p.steps.length + ' 步）</b><ol class="ord">' +
      p.steps.map(function (s) { return '<li>' + esc(s.name) + ' <span class="tp">' + esc(s.type) + '</span></li>'; }).join('') +
      '</ol></div>' +
      (p.skipped.length ? '<div class="blk"><b>未进入你的路径（' + p.skipped.length + ' 步）</b><ul class="skip">' +
        p.skipped.map(function (s) { return '<li><s>' + esc(s.step.name) + '</s>　<span class="dim">' + esc(s.reason) + '</span></li>'; }).join('') +
        '</ul></div>' : '') +
      '</div>';
  }
  function optionLabelBranch(sc, k) {
    var q = k;
    sc.branches.forEach(function (b) { if (b.id === k) q = b.q.replace(/？$/, ''); });
    return q;
  }

  /* ---------- ③ 执行助手 ---------- */
  function execOut(sc, p) {
    return '<div class="s-out">' +
      '<div class="s-note">只为每一步补齐四字段（入口 / 地点 / 材料 / 注意），<b>不修改①的事实、不调整②的顺序</b>。</div>' +
      '<table class="mini"><tr><th style="width:20%">步骤</th><th>入口</th><th>地点（按校区）</th><th style="width:22%">材料</th></tr>' +
      p.steps.map(function (s) {
        return '<tr><td>' + esc(s.name) + '</td>' +
          '<td>' + esc(s.entry || '—') + '</td>' +
          '<td>' + esc(resolveCampus(s.place, state.campus)) + '</td>' +
          '<td>' + (arr(s.materials).length ? esc(arr(s.materials).join('、')) : '—') + '</td></tr>';
      }).join('') + '</table></div>';
  }

  /* ---------- 收口 ---------- */
  function mergeOut(sc, p) {
    return '<div class="s-out">' +
      '<div class="s-note ok">三路结果由理小办统一收口，输出一张办事卡：结论先行、步骤可执行、依据可追溯。</div>' +
      '<div class="mini-kv"><span>结论</span><b>' + esc(sc.summary) + '</b></div>' +
      '<div class="mini-kv"><span>步骤数</span><b>' + p.steps.length + ' 步（已从 ' + sc.steps.length + ' 个候选步骤中筛出）</b></div>' +
      '<div class="mini-kv"><span>依据条数</span><b>' + sc.facts.length + ' 条，均可回溯到文件与位置</b></div>' +
      '</div>';
  }

  /* ---------- 办事卡 ---------- */
  function renderCardOnly() {
    var sc = state.scenario, p = plan(sc, state.answers);
    state.plan = p;
    renderCard(sc, p);
  }

  function renderCard(sc, p) {
    var cid = state.campus;
    var card = $('card');

    var todos = [];
    sc.facts.forEach(function (f) { if (f.v === 'todo') todos.push({ t: f.t, s: f.src + ' · ' + f.loc }); });
    p.steps.forEach(function (s) {
      var fields = [s.entry, resolveCampus(s.place, cid), resolveCampus(s.window, cid)].concat(arr(s.materials), arr(s.notes));
      var hit = fields.filter(function (x) { return String(x || '').indexOf('待核实') >= 0; });
      if (hit.length) todos.push({ t: s.name + '：' + hit.join(' / '), s: s.src });
    });

    var html = '';
    html += '<div class="ck-head"><span class="ck-badge">办事卡</span>' +
      '<h3>' + esc(sc.name) + '</h3>' +
      '<div class="ck-meta">' + esc(campusName(cid)) + '　|　共 ' + p.steps.length + ' 步　|　' +
      Object.keys(state.answers).map(function (k) {
        return esc(optionLabel(sc, k, state.answers[k]));
      }).join(' · ') + '</div></div>';

    html += '<div class="ck-concl"><span>结论</span><p>' + esc(sc.summary) + '</p></div>';

    html += '<h4 class="ck-h">一、你要做的事</h4><table class="ck">' +
      '<tr><th style="width:34px">#</th><th style="width:15%">步骤</th><th style="width:74px">类型</th>' +
      '<th style="width:20%">入口</th><th style="width:19%">地点</th><th>材料 / 注意</th><th style="width:76px">时长</th></tr>' +
      p.steps.map(function (s, i) {
        var notes = arr(s.notes).map(function (n) { return '<span class="nt">' + esc(n) + '</span>'; }).join('');
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td><b>' + esc(s.name) + '</b>' + (arr(s.dependsOn).length ? '<div class="dep">须先完成前序步骤</div>' : '') + '</td>' +
          '<td><span class="tp">' + esc(s.type) + '</span></td>' +
          '<td>' + esc(s.entry || '—') + '</td>' +
          '<td>' + esc(resolveCampus(s.place, cid)) +
          (s.window ? '<div class="win">' + esc(resolveCampus(s.window, cid)) + '</div>' : '') + '</td>' +
          '<td>' + (arr(s.materials).length ? '<div class="mat">' + esc(arr(s.materials).join('、')) + '</div>' : '') + notes + '</td>' +
          '<td>' + esc(s.time || '—') + '</td></tr>';
      }).join('') + '</table>';

    html += '<h4 class="ck-h">二、依据（可追溯）</h4><table class="ck src">' +
      '<tr><th style="width:44%">依据内容</th><th>出处</th><th style="width:88px">核实状态</th></tr>' +
      sc.facts.map(function (f) {
        return '<tr><td>' + esc(f.t) + '</td><td>' + esc(f.src) + '　<span class="loc">' + esc(f.loc) + '</span></td>' +
          '<td>' + (f.v === 'doc' ? '<span class="tag tag-doc">文档示例</span>' : '<span class="tag tag-todo">待核实</span>') + '</td></tr>';
      }).join('') + '</table>';

    if (todos.length) {
      html += '<h4 class="ck-h warn">三、使用前必须先确认的信息（' + todos.length + ' 条）</h4>' +
        '<table class="ck todo"><tr><th style="width:60%">待确认项</th><th>应向谁确认</th></tr>' +
        todos.map(function (t) {
          return '<tr><td>' + esc(t.t) + '</td><td>' + esc(t.s) + '　<span class="dim">→ 以官方渠道答复为准</span></td></tr>';
        }).join('') + '</table>';
    }

    html += '<div class="disc">本办事卡由「理小办」依据检索到的规章原文整理生成，不代表学校办理结果。' +
      '凡标注「待核实」的内容均为占位示例，使用前请以学校官方通知和经办部门答复为准。</div>';

    card.innerHTML = html;
    state.cardText = buildMarkdown(sc, p, todos, cid);
  }

  function buildMarkdown(sc, p, todos, cid) {
    var L = [];
    L.push('# 办事卡 · ' + sc.name);
    L.push('');
    L.push('- 校区：' + campusName(cid));
    Object.keys(state.answers).forEach(function (k) {
      L.push('- ' + optionLabelBranch(sc, k) + '：' + optionLabel(sc, k, state.answers[k]));
    });
    L.push('');
    L.push('## 结论');
    L.push(sc.summary);
    L.push('');
    L.push('## 你要做的事');
    L.push('| # | 步骤 | 类型 | 入口 | 地点 | 材料 | 时长 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- |');
    p.steps.forEach(function (s, i) {
      L.push('| ' + (i + 1) + ' | ' + s.name + ' | ' + s.type + ' | ' + (s.entry || '—') + ' | ' +
        resolveCampus(s.place, cid) + ' | ' + (arr(s.materials).join('、') || '—') + ' | ' + (s.time || '—') + ' |');
    });
    L.push('');
    p.steps.forEach(function (s, i) {
      if (arr(s.notes).length) L.push((i + 1) + '. **' + s.name + '** 注意：' + arr(s.notes).join('；'));
    });
    L.push('');
    L.push('## 依据');
    L.push('| 内容 | 出处 | 状态 |');
    L.push('| --- | --- | --- |');
    sc.facts.forEach(function (f) {
      L.push('| ' + f.t + ' | ' + f.src + ' · ' + f.loc + ' | ' + (f.v === 'doc' ? '文档示例' : '待核实') + ' |');
    });
    if (todos.length) {
      L.push('');
      L.push('## 使用前需确认');
      todos.forEach(function (t) { L.push('- ' + t.t + '（确认渠道：' + t.s + '）'); });
    }
    L.push('');
    L.push('> 本卡由「理小办」整理生成，不代表学校办理结果；标注「待核实」的内容请以官方渠道答复为准。');
    return L.join('\n');
  }

  function copyCard() {
    var txt = state.cardText || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { flash('已复制办事卡 Markdown'); },
        function () { fallbackCopy(txt); });
    } else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); flash('已复制办事卡 Markdown'); } catch (e) { flash('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }
  function flash(m) {
    var b = $('copyBtn'), o = b.textContent;
    b.textContent = m;
    window.setTimeout(function () { b.textContent = o; }, 1600);
  }

  /* ---------- 静态区块 ---------- */
  function renderMigrate() {
    $('migrateList').innerHTML = LXB.migrate.map(function (m, i) {
      return '<div class="card"><div class="idx">' + (i + 1) + '</div><h3>' + esc(m.k) + '</h3><p>' + esc(m.d) + '</p></div>';
    }).join('');
  }
  function renderMetrics() {
    $('metricList').innerHTML = LXB.metrics.map(function (m) {
      return '<div class="metric"><div class="mnum">待实测</div><div class="mk">' + esc(m.k) + '</div>' +
        '<div class="md">' + esc(m.d) + '</div><div class="mu">单位：' + esc(m.unit) + '</div></div>';
    }).join('');
  }
  function renderScenarioLib() {
    $('libList').innerHTML = S.map(function (sc) {
      return '<div class="card lib"><div class="idx">' + esc(sc.icon) + '</div>' +
        '<h3>' + esc(sc.name) + ' <span class="tag tag-' + (sc.id === 'card' ? 'doc' : 'todo') + '">' + esc(sc.badge) + '</span></h3>' +
        '<p>' + esc(sc.summary) + '</p>' +
        '<div class="trig">' + sc.triggers.slice(0, 5).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="meta">' + sc.steps.length + ' 个候选步骤 · ' + sc.facts.length + ' 条依据 · ' +
        (sc.branches.length ? sc.branches.length + ' 个分支' : '无分支') + '</div></div>';
    }).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
