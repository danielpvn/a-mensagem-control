// Pedidos de oração (aba Culto): o operador só escreve os nomes, a tela é montada sozinha.
import { $, confirmDialog } from './ui.js';
import * as ws from './ws.js';
import { createBackgroundPicker } from './backgrounds.js';

let prayer = { visible: false, title: '', names: [] };
let styles = {};
let sendTimer = null;
let pendingUntil = 0; // até quando o texto digitado aqui ainda não voltou do servidor

const el = {
  title: $('prayer-title'),
  names: $('prayer-names'),
  count: $('prayer-count'),
  summary: $('prayer-summary'),
  toggle: $('btn-prayer-toggle')
};

const typedNames = () => el.names.value.split('\n').map(n => n.trim()).filter(Boolean);

// Manda o texto ao servidor um instante depois de parar de digitar (a tela no ar atualiza junto)
function queueSend() {
  clearTimeout(sendTimer);
  pendingUntil = Date.now() + 2500;
  sendTimer = setTimeout(sendNow, 350);
  renderCount();
  el.toggle.disabled = !prayer.visible && typedNames().length === 0;
}

function sendNow() {
  clearTimeout(sendTimer);
  pendingUntil = Date.now() + 1500;
  ws.send('prayer-set', { title: el.title.value, names: typedNames() });
}

function renderCount() {
  const n = typedNames().length;
  el.count.textContent = n === 1 ? '1 nome' : `${n} nomes`;
}

function render() {
  const editing = document.activeElement === el.names || document.activeElement === el.title;
  // O servidor já tem o que foi digitado aqui: pode voltar a acompanhar o servidor
  if (typedNames().join('\n') === prayer.names.join('\n') && el.title.value.trim() === prayer.title) pendingUntil = 0;
  if (!editing && Date.now() > pendingUntil) {
    // Só reescreve o que está na caixa se veio algo diferente (de outro aparelho, por exemplo)
    if (typedNames().join('\n') !== prayer.names.join('\n')) el.names.value = prayer.names.join('\n');
    if (el.title.value !== prayer.title) el.title.value = prayer.title;
  }
  renderCount();
  el.summary.textContent = prayer.names.length ? prayer.names.join(' · ') : 'Nenhum nome ainda.';
  el.toggle.textContent = prayer.visible ? 'Ocultar pedidos de oração' : 'Exibir pedidos de oração';
  el.toggle.classList.toggle('btn-danger', prayer.visible);
  el.toggle.classList.toggle('btn-primary', !prayer.visible);
  el.toggle.disabled = !prayer.visible && typedNames().length === 0;
}

// ---------- Aparência ----------

const styleInputs = ['prayer-font', 'prayer-size', 'prayer-name-color', 'prayer-title-color', 'prayer-accent-color', 'prayer-bg-color', 'prayer-decor', 'prayer-noanim'].map($);
let picker = null;

function fillStyles(s) {
  styles = { ...styles, ...s };
  if (picker) picker.render();
  if (styleInputs.includes(document.activeElement)) return;
  $('prayer-font').value = styles.fontFamily || 'Montserrat, sans-serif';
  $('prayer-size').value = styles.scale ?? 1;
  $('prayer-size-val').textContent = `${Math.round((styles.scale ?? 1) * 100)}%`;
  $('prayer-name-color').value = styles.nameColor || '#ffffff';
  $('prayer-title-color').value = styles.titleColor || '#f2b632';
  $('prayer-accent-color').value = styles.accentColor || '#f2b632';
  $('prayer-bg-color').value = styles.bgColor || '#333333';
  $('prayer-decor').checked = styles.decor !== false;
  $('prayer-noanim').checked = styles.noAnim === true;
}

function sendStyles() {
  $('prayer-size-val').textContent = `${Math.round(Number($('prayer-size').value) * 100)}%`;
  ws.send('update-prayer-styles', {
    fontFamily: $('prayer-font').value,
    scale: Number($('prayer-size').value),
    nameColor: $('prayer-name-color').value,
    titleColor: $('prayer-title-color').value,
    accentColor: $('prayer-accent-color').value,
    bgColor: $('prayer-bg-color').value,
    decor: $('prayer-decor').checked,
    noAnim: $('prayer-noanim').checked
  });
}

export function setupPrayer() {
  ws.on('init', (state) => {
    prayer = state.prayer || prayer;
    fillStyles(state.prayerStyles || {});
    render();
  });
  ws.on('update-content', (state) => {
    prayer = state.prayer || prayer;
    render();
  });
  ws.on('update-prayer-style', fillStyles);

  el.names.addEventListener('input', queueSend);
  el.title.addEventListener('input', queueSend);
  el.toggle.onclick = () => {
    if (prayer.visible) {
      ws.send('prayer-hide');
      return;
    }
    // Garante que o servidor tem o texto mais novo antes de exibir
    sendNow();
    ws.send('prayer-show');
  };
  $('btn-prayer-clear').onclick = async () => {
    const ok = await confirmDialog({ title: 'Apagar todos os nomes?', text: 'A lista de pedidos de oração fica vazia.', okLabel: 'Apagar', danger: true });
    if (!ok) return;
    el.names.value = '';
    ws.send('prayer-hide');
    sendNow();
  };

  styleInputs.forEach(input => input.addEventListener('input', sendStyles));
  picker = createBackgroundPicker($('prayer-bg-picker'), {
    getValue: () => styles.bgImage || null,
    onSelect: (url) => ws.send('update-prayer-styles', { bgImage: url })
  });
  $('btn-prayer-reset').onclick = () => ws.send('reset-prayer-styles');
}
