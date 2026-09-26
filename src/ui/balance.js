import {
  SECTIONS, PARAMS, getValue, setValue, defaultValue, isChanged, resetAll, overrides, summaryText,
} from '../game/balance.js';

const $ = (selector) => document.querySelector(selector);

/** 같은 group이 이어지는 수치들을 묶는다: [[group, params], ...] */
function byGroup(params) {
  const groups = [];
  for (const p of params) {
    const last = groups.at(-1);
    if (last && last[0] === p.group) last[1].push(p); else groups.push([p.group, [p]]);
  }
  return groups;
}

const today = () => new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * 밸런스 조정 화면(수치 입력)과 현재 수치 보기 화면(한 화면 요약, 캡처·복사용).
 * handlers.show(name)으로 화면을 바꾸고, 값이 바뀔 때마다 handlers.onChange(overrides)를 부른다.
 */
export function createBalanceScreens(handlers) {
  const inputs = new Map();

  function syncRow(p) {
    const input = inputs.get(p.id);
    input.value = String(getValue(p));
    input.closest('.param').classList.toggle('changed', isChanged(p));
  }
  const syncAll = () => { for (const p of PARAMS) syncRow(p); };
  const changed = () => handlers.onChange(overrides());

  function buildForm() {
    const form = $('#balance-form');
    form.replaceChildren(...SECTIONS.map((section, i) => {
      const details = document.createElement('details');
      details.className = 'balance-section';
      details.open = i === 0;
      const summary = document.createElement('summary');
      summary.textContent = section.title;
      details.append(summary);
      const grid = document.createElement('div');
      grid.className = 'balance-groups';
      for (const [group, params] of byGroup(section.params)) {
        const fieldset = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = group;
        fieldset.append(legend);
        for (const p of params) {
          const row = document.createElement('label');
          row.className = 'param';
          const name = document.createElement('span');
          name.textContent = p.label;
          const input = document.createElement('input');
          input.type = 'number';
          input.inputMode = 'decimal';
          input.min = String(p.min);
          input.max = String(p.max);
          input.step = String(p.step);
          input.addEventListener('change', () => {
            setValue(p, input.value);
            // 최소·최대 쌍처럼 다른 칸이 함께 바뀔 수 있어 같은 묶음을 다시 맞춘다.
            for (const q of params) syncRow(q);
            changed();
          });
          const def = document.createElement('small');
          def.textContent = `기본 ${defaultValue(p)}${p.unit}`;
          const unit = document.createElement('em');
          unit.textContent = p.unit;
          row.append(name, input, unit, def);
          inputs.set(p.id, input);
          fieldset.append(row);
        }
        grid.append(fieldset);
      }
      details.append(grid);
      return details;
    }));
  }

  function buildSummary() {
    const changedCount = PARAMS.filter(isChanged).length;
    $('#summary-meta').textContent =
      `${today()} 기준 · 전체 ${PARAMS.length}개 중 ${changedCount}개 변경(노란 칸, 괄호 안은 기본값)`;
    const blocks = [];
    for (const section of SECTIONS) {
      for (const [group, params] of byGroup(section.params)) {
        const block = document.createElement('section');
        block.className = 'summary-block';
        const title = document.createElement('h3');
        title.textContent = group;
        const table = document.createElement('table');
        for (const p of params) {
          const tr = document.createElement('tr');
          if (isChanged(p)) tr.className = 'changed';
          const th = document.createElement('th');
          th.scope = 'row';
          th.textContent = p.label;
          const td = document.createElement('td');
          td.textContent = `${getValue(p)}${p.unit}`;
          if (isChanged(p)) {
            const def = document.createElement('small');
            def.textContent = ` (${defaultValue(p)})`;
            td.append(def);
          }
          tr.append(th, td);
          table.append(tr);
        }
        block.append(title, table);
        blocks.push(block);
      }
    }
    $('#summary-grid').replaceChildren(...blocks);
    $('#summary-copy-status').textContent = '';
  }

  function open() {
    if (!inputs.size) buildForm();
    syncAll();
    handlers.show('balance');
  }

  function openSummary() {
    buildSummary();
    handlers.show('summary');
  }

  $('#balance-summary-btn').addEventListener('click', openSummary);
  $('#summary-back-btn').addEventListener('click', open);
  for (const btn of document.querySelectorAll('.balance-close-btn')) btn.addEventListener('click', handlers.onClose);
  $('#balance-reset-btn').addEventListener('click', () => {
    if (!window.confirm('모든 수치를 기본값으로 되돌릴까요?')) return;
    resetAll();
    syncAll();
    changed();
  });
  $('#summary-copy-btn').addEventListener('click', async () => {
    const status = $('#summary-copy-status');
    try {
      await navigator.clipboard.writeText(summaryText());
      status.textContent = '복사했습니다. 메신저 등에 붙여 넣어 전달하세요.';
    } catch {
      status.textContent = '복사할 수 없는 환경입니다. 화면을 캡처해 전달하세요.';
    }
  });

  return { open, openSummary };
}
