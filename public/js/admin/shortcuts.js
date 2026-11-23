// Atalhos de teclado escolhidos pelo operador (Configurações > Atalhos de teclado).
// O servidor guarda; aqui o painel mostra a lista, grava a tecla apertada e diz qual ação uma tecla faz.
import { $, toast } from './ui.js';
import * as ws from './ws.js';
import { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, cleanShortcuts, keyFromEvent, keyLabel } from '../shared/shortcuts.js';

let map = cleanShortcuts(DEFAULT_SHORTCUTS);
let capturing = null; // id da ação esperando uma tecla

export const isCapturingShortcut = () => capturing !== null;

// Ação do painel para a tecla apertada (os do passador são do Electron, com o app minimizado)
export function actionForEvent(e) {
  const key = keyFromEvent(e);
  if (!key) return null;
  const action = SHORTCUT_ACTIONS.find(a => !a.global && (map[a.id] || []).includes(key));
  return action ? action.id : null;
}

// Dicas de teclas embaixo de cada aba e no botão do nome: seguem o que foi escolhido aqui
export function renderHints() {
  document.querySelectorAll('[data-hint]').forEach(hint => {
    hint.innerHTML = '';
    const parts = hint.dataset.hint.split('|').map(p => p.split(':')).filter(([id]) => (map[id] || []).length);
    parts.forEach(([id, text], i) => {
      if (i) hint.append(' · ');
      map[id].slice(0, 2).forEach(key => {
        const kbd = document.createElement('kbd');
        kbd.textContent = keyLabel(key);
        hint.append(kbd, ' ');
      });
      hint.append(text);
    });
    hint.hidden = parts.length === 0;
  });
  document.querySelectorAll('[data-key-of]').forEach(el => {
    const keys = map[el.dataset.keyOf] || [];
    el.textContent = keys.length ? keyLabel(keys[0]) : '';
    el.hidden = keys.length === 0;
  });
  document.querySelectorAll('[data-key-sentence]').forEach(el => { el.hidden = !(map[el.dataset.keySentence] || []).length; });
}

function save(next) {
  map = cleanShortcuts(next);
  render();
  ws.send('shortcuts', { map });
}

function addKey(id, key) {
  const target = SHORTCUT_ACTIONS.find(a => a.id === id);
  const next = { ...map };
  // A mesma tecla não pode fazer duas coisas no mesmo grupo (painel ou passador)
  SHORTCUT_ACTIONS.forEach(a => {
    if (a.id !== id && !!a.global === !!target.global && next[a.id].includes(key)) {
      next[a.id] = next[a.id].filter(k => k !== key);
      toast(`"${keyLabel(key)}" saiu de "${a.label}" e agora é de "${target.label}".`);
    }
  });
  if (!next[id].includes(key)) next[id] = [...next[id], key];
  save(next);
}

function render() {
  renderHints();
  const list = $('shortcut-list');
  list.innerHTML = '';
  let lastGroup = null;
  SHORTCUT_ACTIONS.forEach(action => {
    const group = action.global ? 'global' : 'panel';
    if (group !== lastGroup) {
      lastGroup = group;
      const title = document.createElement('div');
      title.className = 'shortcut-group';
      title.textContent = action.global ? 'Passador (funciona com o app minimizado)' : 'No painel';
      list.appendChild(title);
    }
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const info = document.createElement('div');
    info.className = 'shortcut-info';
    info.innerHTML = '<strong></strong><span class="muted small"></span>';
    info.querySelector('strong').textContent = action.label;
    info.querySelector('span').textContent = action.hint;

    const keys = document.createElement('div');
    keys.className = 'shortcut-keys';
    const current = map[action.id] || [];
    if (current.length === 0) {
      const none = document.createElement('span');
      none.className = 'muted small';
      none.textContent = 'Sem atalho';
      keys.appendChild(none);
    }
    current.forEach(key => {
      const chip = document.createElement('span');
      chip.className = 'key-chip';
      const kbd = document.createElement('kbd');
      kbd.textContent = keyLabel(key);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'key-remove';
      remove.textContent = '×';
      remove.title = 'Tirar esta tecla';
      remove.onclick = () => save({ ...map, [action.id]: current.filter(k => k !== key) });
      chip.append(kbd, remove);
      keys.appendChild(chip);
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-secondary btn-sm key-add';
    const waiting = capturing === action.id;
    add.classList.toggle('is-waiting', waiting);
    add.textContent = waiting ? 'Aperte a tecla...' : '+ Tecla';
    add.title = waiting ? 'Clique de novo para cancelar' : 'Clique e aperte a tecla que vai fazer isso';
    add.onclick = () => {
      capturing = waiting ? null : action.id;
      render();
    };
    keys.appendChild(add);
    row.append(info, keys);
    list.appendChild(row);
  });
}

export function setupShortcuts() {
  ws.on('init', (state) => { map = cleanShortcuts(state.shortcuts); render(); });
  ws.on('update-shortcuts', (next) => { map = cleanShortcuts(next); render(); });

  // Gravando: a próxima tecla vira atalho da ação (antes de qualquer outro atalho do painel)
  window.addEventListener('keydown', (e) => {
    if (!capturing) return;
    const key = keyFromEvent(e);
    if (!key) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const id = capturing;
    capturing = null;
    addKey(id, key);
  }, true);
  // Clicou fora: desiste de gravar
  document.addEventListener('click', (e) => {
    if (capturing && !e.target.closest('.key-add')) {
      capturing = null;
      render();
    }
  });

  $('btn-shortcuts-reset').onclick = () => {
    capturing = null;
    ws.send('reset-shortcuts');
    toast('Atalhos voltaram ao padrão.', 'success');
  };
  render();
}
