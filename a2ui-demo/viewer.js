/**
 * A2UI v0.9 클라이언트 viewer.
 *   1. /form.jsonl fetch
 *   2. createSurface + updateComponents + updateDataModel 메시지 처리
 *   3. 컴포넌트 트리 렌더링 (DOM)
 *   4. input 이벤트로 dataModel 동기화
 *   5. Button action="submit_work_plan" 누르면 POST /api/save
 */

const state = {
  surfaces: {},
  components: {},
  dataModel: {},
};

// ============================================================
// JSONL 파싱 (multi-line 지원)
// ============================================================
function splitTopLevelObjects(text) {
  const objects = [];
  let depth = 0, inString = false, escape = false, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function applyMessages(text) {
  const raw = splitTopLevelObjects(text);
  for (const r of raw) {
    let msg;
    try { msg = JSON.parse(r); } catch { continue; }
    if (msg.createSurface) {
      state.surfaces[msg.createSurface.surfaceId] = {
        catalogId: msg.createSurface.catalogId,
        root: null,
      };
    } else if (msg.updateComponents) {
      const u = msg.updateComponents;
      if (state.surfaces[u.surfaceId]) state.surfaces[u.surfaceId].root = u.root;
      for (const c of u.components || []) state.components[c.id] = c;
    } else if (msg.updateDataModel) {
      const u = msg.updateDataModel;
      if (u.op === 'replace') setPath(u.path, u.value);
    }
  }
}

// ============================================================
// 데이터 모델 (JSON Pointer)
// ============================================================
function setPath(path, value) {
  const keys = path.split('/').filter(Boolean);
  if (keys.length === 0) { state.dataModel = value; return; }
  let target = state.dataModel;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof target[keys[i]] !== 'object' || target[keys[i]] === null) target[keys[i]] = {};
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
}

function getPath(path) {
  const keys = path.split('/').filter(Boolean);
  let cur = state.dataModel;
  for (const k of keys) {
    if (typeof cur !== 'object' || cur === null || !(k in cur)) return null;
    cur = cur[k];
  }
  return cur;
}

function resolveValue(val) {
  if (val && typeof val === 'object' && 'path' in val) {
    const v = getPath(val.path);
    return v !== null ? v : (val.literalString || '');
  }
  return val;
}

// ============================================================
// 컴포넌트 렌더링
// ============================================================
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') e.className = v;
    else if (k === 'innerHTML') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

function renderComponent(cid) {
  const c = state.components[cid];
  if (!c) return el('div', { className: 'error' }, [`missing: ${cid}`]);
  const t = c.component;

  if (t === 'Column') {
    return el('div', { className: 'a2ui-column' }, (c.children || []).map(renderComponent));
  }
  if (t === 'Row') {
    return el('div', { className: 'a2ui-row ' + (c.distribution || '') }, (c.children || []).map(renderComponent));
  }
  if (t === 'Card') {
    return el('div', { className: 'a2ui-card' }, c.child ? [renderComponent(c.child)] : []);
  }
  if (t === 'Divider') {
    return el('div', { className: 'a2ui-divider' });
  }
  if (t === 'Text') {
    const text = resolveValue(c.text || '');
    const hint = c.usageHint || 'body';
    let extra = '';
    if (typeof text === 'string') {
      if (text.startsWith('📝')) extra = ' guide';
      else if (text.startsWith('⚠')) extra = ' warn';
      else if (text.startsWith('✓')) extra = ' auto';
      else if (text.startsWith('예시')) extra = ' example';
    }
    return el('div', { className: `a2ui-text-${hint}${extra}` }, [String(text || '')]);
  }
  if (t === 'TextField') {
    const value = resolveValue(c.text || '') || '';
    const filled = value !== '' && value !== 0;
    const wrapCls = `a2ui-textfield ${filled ? 'auto-filled' : 'empty'}`;
    const inputType = c.usageHint === 'number' ? 'number' : 'text';
    const path = c.text && typeof c.text === 'object' ? c.text.path : null;

    const input = el('input', {
      type: inputType,
      value: String(value),
      placeholder: '(입력)',
    });
    input.addEventListener('input', (e) => {
      if (path) {
        const v = inputType === 'number' ? Number(e.target.value) : e.target.value;
        setPath(path, v);
        // 시각 업데이트
        if (e.target.value !== '') input.parentElement.className = 'a2ui-textfield auto-filled';
        else input.parentElement.className = 'a2ui-textfield empty';
      }
    });
    return el('div', { className: wrapCls }, [
      el('label', {}, [c.label || '']),
      input,
    ]);
  }
  if (t === 'ChoicePicker') {
    const opts = c.options || [];
    const value = resolveValue(c.value || '') || '';
    const path = c.value && typeof c.value === 'object' ? c.value.path : null;
    const select = el('select');
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', (e) => { if (path) setPath(path, e.target.value); });
    return el('div', { className: 'a2ui-choice' }, [
      el('label', {}, ['선택']),
      select,
    ]);
  }
  if (t === 'DateTimeInput') {
    return el('input', {
      className: 'a2ui-datetime',
      type: c.enableDate ? 'date' : 'time',
    });
  }
  if (t === 'Button') {
    const action = (c.action && c.action.name) || '';
    const btn = el('button', {
      className: action === 'submit_work_plan' ? 'a2ui-button' : 'a2ui-button secondary',
    }, c.child ? [renderComponent(c.child)] : []);
    btn.addEventListener('click', () => handleAction(action, c.action));
    return btn;
  }
  return el('div', {}, [`unknown: ${t}`]);
}

// ============================================================
// Action 처리 — 백엔드 호출
// ============================================================
async function handleAction(name, action) {
  const banner = document.getElementById('saved-banner');
  if (name === 'submit_work_plan' || name === 'save_draft') {
    const payload = {
      formId: 'work-plan',
      action: name,
      input: state.dataModel.input || {},
      auto: state.dataModel.auto || {},
    };

    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (json.success) {
        banner.className = 'saved-banner show';
        banner.innerHTML = `
          <strong>✅ 저장 성공</strong><br>
          ID: <code>${json.id}</code> · ${json.submittedAt} · ${json.sizeBytes} bytes<br>
          저장 위치: <code>${json.storedAt}</code>
          <details style="margin-top:8px"><summary>POST 응답 보기</summary><pre>${JSON.stringify(json, null, 2)}</pre></details>
        `;
        document.getElementById('status').textContent = `✅ 저장됨: ${json.id}`;
        document.getElementById('status').className = 'success';
      } else {
        throw new Error(json.error || 'save failed');
      }
    } catch (e) {
      banner.className = 'saved-banner show error';
      banner.innerHTML = `<strong>❌ 저장 실패</strong><br>${e.message}`;
    }
  }
}

// ============================================================
// 초기 로드
// ============================================================
async function bootstrap() {
  try {
    const res = await fetch('/form.jsonl');
    const text = await res.text();
    applyMessages(text);

    const rootId = Object.values(state.surfaces)[0].root;
    const rootEl = renderComponent(rootId);
    const container = document.getElementById('a2ui-root');
    container.innerHTML = '';
    container.appendChild(rootEl);

    document.getElementById('status').textContent =
      `✅ 로드 완료 · 컴포넌트 ${Object.keys(state.components).length}개 · 자동 채움 ${Object.keys(state.dataModel.auto || {}).length}개`;
    document.getElementById('status').className = 'success';
  } catch (e) {
    document.getElementById('status').textContent = `❌ 로드 실패: ${e.message}`;
    document.getElementById('status').className = 'error';
  }
}

window.addEventListener('DOMContentLoaded', bootstrap);

// 디버그용: 콘솔에서 상태 확인 가능
window.__a2ui_state = state;
window.__a2ui_simulate_input = (key, value) => {
  setPath(`/input/${key}`, value);
  // 다시 렌더
  const rootId = Object.values(state.surfaces)[0].root;
  const rootEl = renderComponent(rootId);
  const container = document.getElementById('a2ui-root');
  container.innerHTML = '';
  container.appendChild(rootEl);
};
