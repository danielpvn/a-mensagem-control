// Louvor especial (aba Culto): alguém canta um louvor fora do hinário, sozinho ou com outros.
// Aparece na mesma faixa do nome do pregador, com o visual próprio do grupo "Louvor especial":
// o nome do louvor em cima e quem canta embaixo, com uma bolinha entre os nomes
// ("Maria Silva • João Pereira"). Os recentes ficam guardados neste aparelho.
import { $, previewInPanel } from './ui.js';
import * as ws from './ws.js';
import { setupLtStyleControls } from './lowerthird.js';

const SEPARATOR = '  •  ';
let lt = { visible: false };

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sem armazenamento */ }
};

// ---------- Campos de cantores (um campinho por pessoa) ----------

const singerInputs = () => [...$('special-singers').querySelectorAll('input')];

function addSinger(value = '', focus = false) {
  const row = document.createElement('div');
  row.className = 'singer-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 50;
  input.autocomplete = 'off';
  input.placeholder = singerInputs().length === 0 ? 'Nome (ex: Irmã Maria Silva)' : 'Mais um nome';
  input.value = value;
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter no último nome mostra no telão; nos outros, vai para o próximo campo
      const inputs = singerInputs();
      const index = inputs.indexOf(input);
      if (index < inputs.length - 1) inputs[index + 1].focus();
      else { input.blur(); if (!$('btn-special-toggle').disabled) $('btn-special-toggle').click(); }
    }
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-x';
  remove.title = 'Tirar este nome';
  remove.textContent = '×';
  remove.onclick = () => {
    row.remove();
    if (singerInputs().length === 0) addSinger();
    render();
  };
  row.append(input, remove);
  $('special-singers').appendChild(row);
  if (focus) input.focus();
}

function setSingers(names) {
  $('special-singers').innerHTML = '';
  (names.length ? names : ['']).forEach(name => addSinger(name));
}

// ---------- O que vai na faixa ----------

function fromForm() {
  return {
    title: $('special-title').value.trim(),
    singers: singerInputs().map(i => i.value.trim()).filter(Boolean)
  };
}

// Sem nome do louvor, os nomes de quem canta vão em cima
function linesOf({ title, singers }) {
  const names = singers.join(SEPARATOR);
  return title ? { name: title, subtitle: names } : { name: names, subtitle: '' };
}

const sameLines = (a, b) => a.name === b.name && (a.subtitle || '') === (b.subtitle || '');
const liveLines = () => (lt.visible && lt.kind === 'special' ? { name: lt.name, subtitle: lt.subtitle || '' } : null);

function render() {
  const lines = linesOf(fromForm());
  const live = liveLines();
  const isLive = !!(live && lines.name && sameLines(live, lines));
  $('special-sample').hidden = !lines.name;
  $('special-sample-name').textContent = lines.name;
  $('special-sample-sub').textContent = lines.subtitle;
  $('special-sample-sub').hidden = !lines.subtitle;
  const btn = $('btn-special-toggle');
  btn.disabled = !lines.name && !isLive;
  btn.textContent = isLive ? 'Esconder do telão' : 'Mostrar no telão';
  btn.classList.toggle('btn-danger', isLive);
  btn.classList.toggle('btn-primary', !isLive);
  renderRecent(live);
}

function renderRecent(live) {
  const recent = readJson('amc.specials', []).filter(item => Array.isArray(item.singers));
  $('special-recent-wrap').hidden = recent.length === 0;
  const list = $('special-recent');
  list.innerHTML = '';
  recent.forEach((item, i) => {
    const lines = linesOf(item);
    const row = document.createElement('div');
    row.className = 'special-item';
    row.classList.toggle('on-air', !!(live && sameLines(live, lines)));
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'special-use';
    use.title = 'Usar de novo';
    const name = document.createElement('strong');
    name.textContent = lines.name;
    const sub = document.createElement('span');
    sub.textContent = lines.subtitle || ' ';
    use.append(name, sub);
    use.onclick = () => {
      $('special-title').value = item.title || '';
      setSingers(item.singers);
      render();
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x';
    remove.title = 'Tirar dos recentes';
    remove.textContent = '×';
    remove.onclick = () => {
      writeJson('amc.specials', recent.filter((_, j) => j !== i));
      render();
    };
    row.append(use, remove);
    list.appendChild(row);
  });
}

function remember(item) {
  const key = (x) => `${x.title}|${x.singers.join('|')}`.toLowerCase();
  const recent = readJson('amc.specials', []).filter(x => Array.isArray(x.singers) && key(x) !== key(item));
  writeJson('amc.specials', [item, ...recent].slice(0, 12));
}

export function setupSpecial() {
  setSingers([]);
  $('btn-special-add-singer').onclick = () => addSinger('', true);
  $('special-title').addEventListener('input', render);
  $('special-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); singerInputs()[0].focus(); }
  });

  $('btn-special-toggle').onclick = () => {
    const item = fromForm();
    const lines = linesOf(item);
    const live = liveLines();
    if (live && sameLines(live, lines)) {
      ws.send('lt-hide');
      return;
    }
    if (!lines.name) return;
    remember(item);
    ws.send('lt-show', { ...lines, kind: 'special' });
  };

  const onState = (state) => {
    lt = state.lowerThird || lt;
    render();
  };
  ws.on('init', onState);
  ws.on('update-content', onState);

  setupLtStyleControls({
    prefix: 'sp',
    type: 'special',
    stateKey: 'specialStyles',
    defaults: { accentColor: '#f2b632' },
    preview: () => {
      const lines = linesOf(fromForm());
      previewInPanel({
        type: 'preview-lt',
        kind: 'special',
        name: lines.name || 'Grandioso És Tu',
        subtitle: lines.name ? lines.subtitle : `Maria Silva${SEPARATOR}João Pereira`
      });
    }
  });
  render();
}
