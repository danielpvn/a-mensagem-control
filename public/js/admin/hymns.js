// Aba Hinos: busca por trecho da letra, estrofes, editor e importação.
import { $, toast, confirmDialog, normalize, setupModalClose } from './ui.js';
import * as ws from './ws.js';
import { parseLyrics, buildSequence, slideName } from '../shared/hymn-text.js';
import { makeSortable, moveItem } from './sortable.js';

let hymnList = [];        // todos os hinos (para quando a busca está vazia)
let results = [];         // o que está listado agora
let focusedIndex = 0;     // resultado escolhido com ↑ ↓
let state = null;         // estado do servidor
let renderedKey = '';     // evita redesenhar as estrofes sem necessidade
let searchSeq = 0;
let searchTimer = null;
let lastQuery = '';
let editingId = null;
let categories = [];      // [{ name, count }] vindas do servidor
let category = null;      // categoria escolhida nos chips (null = todas)
try { category = localStorage.getItem('amc.hymnCategory') || null; } catch (e) { /* sem armazenamento */ }

const el = {
  search: $('hymn-search'),
  results: $('hymn-results'),
  title: $('hymn-title'),
  meta: $('hymn-meta'),
  btnEdit: $('btn-hymn-edit'),
  btnDelete: $('btn-hymn-delete'),
  slides: $('hymn-slides'),
  btnPrev: $('btn-hymn-prev'),
  btnNext: $('btn-hymn-next'),
  btnToggle: $('btn-hymn-toggle'),
  btnToggleLabel: $('btn-hymn-toggle-label'),
  nextLabel: $('hymn-next-label'),
  nextText: $('hymn-next-text')
};

const hymnName = (h) => (h.number ? `${h.number} · ${h.title}` : h.title);

// ---------- Lista do culto ----------

const playlist = () => (state && state.hymnPlaylist) || [];
const inPlaylist = (id) => playlist().some(h => h.id === id);
const savePlaylist = (items) => ws.send('hymn-playlist', { items });

function addToPlaylist(hymn) {
  if (inPlaylist(hymn.id)) {
    toast('Esse hino já está na lista do culto.');
    return;
  }
  savePlaylist([...playlist(), { id: hymn.id, number: hymn.number, title: hymn.title, collection: hymn.collection }]);
  toast(`"${hymnName(hymn)}" entrou na lista do culto.`, 'success');
}

// Próximo hino da lista depois do que está aberto (ou o primeiro, se o aberto não está na lista)
function nextInPlaylist() {
  const list = playlist();
  const index = state && state.hymn.id ? list.findIndex(h => h.id === state.hymn.id) : -1;
  return list[index + 1] || null;
}

function setView(view) {
  document.querySelectorAll('input[name="hymn-view"]').forEach(r => { r.checked = r.value === view; });
  $('hymn-search-view').hidden = view !== 'search';
  $('hymn-list-view').hidden = view !== 'list';
  try { localStorage.setItem('amc.hymnView', view); } catch (e) { /* sem armazenamento */ }
}

let playlistKey = '';
function renderPlaylist() {
  const list = playlist();
  const count = $('hymn-list-count');
  count.hidden = list.length === 0;
  count.textContent = list.length;
  $('btn-hymn-list-clear').hidden = list.length === 0;

  const activeId = state.hymn.id;
  const key = `${activeId}|${list.map(h => `${h.id}:${h.number}:${h.title}`).join('|')}`;
  if (key === playlistKey) return;
  playlistKey = key;

  const box = $('hymn-playlist');
  box.innerHTML = '';
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">A lista do culto está vazia.<br>Na busca, clique no <strong>+</strong> de cada hino que vai ser cantado.</div>';
    return;
  }
  list.forEach((hymn, i) => {
    const row = document.createElement('div');
    row.className = 'hymn-item playlist-row';
    row.classList.toggle('active', hymn.id === activeId);
    row.draggable = true;
    row.title = 'Clique para abrir. Arraste para mudar a ordem.';
    row.onclick = () => ws.send('hymn-select', { id: hymn.id });

    const order = document.createElement('span');
    order.className = 'playlist-order';
    order.textContent = i + 1;
    const num = document.createElement('span');
    num.className = 'hymn-num';
    num.textContent = hymn.number || '—';
    const body = document.createElement('span');
    body.className = 'hymn-item-body';
    if (hymn.collection) {
      const tag = document.createElement('span');
      tag.className = 'hymn-category';
      tag.textContent = hymn.collection;
      body.appendChild(tag);
    }
    const title = document.createElement('span');
    title.className = 'hymn-item-title';
    title.textContent = hymn.title;
    body.appendChild(title);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x small';
    remove.title = 'Tirar da lista';
    remove.textContent = '×';
    remove.onclick = (e) => {
      e.stopPropagation();
      savePlaylist(list.filter(h => h.id !== hymn.id));
    };

    row.append(order, num, body, remove);
    box.appendChild(row);
  });
}

function renderPlaylistButtons() {
  const has = !!(state && state.hymn.id);
  const add = $('btn-hymn-list-add');
  add.hidden = !has || inPlaylist(state.hymn.id);
  const next = nextInPlaylist();
  const btnNext = $('btn-hymn-list-next');
  btnNext.hidden = !next;
  if (next) {
    btnNext.textContent = `Próximo da lista: ${next.number || next.title}`;
    btnNext.title = `Abrir "${hymnName(next)}"`;
  }
}

function setupPlaylist() {
  document.querySelectorAll('input[name="hymn-view"]').forEach(r => r.addEventListener('change', () => setView(r.value)));
  let saved = 'search';
  try { saved = localStorage.getItem('amc.hymnView') || 'search'; } catch (e) { /* sem armazenamento */ }
  setView(saved);

  makeSortable($('hymn-playlist'), '.playlist-row', (from, to) => savePlaylist(moveItem(playlist(), from, to)));
  $('btn-hymn-list-add').onclick = () => state.hymn.id && addToPlaylist(state.hymn);
  $('btn-hymn-list-next').onclick = () => {
    const next = nextInPlaylist();
    if (next) ws.send('hymn-select', { id: next.id });
  };
  $('btn-hymn-list-clear').onclick = async () => {
    const ok = await confirmDialog({ title: 'Limpar a lista do culto?', text: 'Os hinos saem só da lista (continuam cadastrados).', okLabel: 'Limpar' });
    if (ok) savePlaylist([]);
  };
}

// ---------- Busca ----------

const categoryParam = () => (category ? `category=${encodeURIComponent(category)}` : '');

async function fetchHymnList() {
  try {
    hymnList = await (await fetch(`/api/hymns?${categoryParam()}`)).json();
    if (!el.search.value.trim()) showAll();
  } catch (err) {
    el.results.innerHTML = '<div class="empty">Erro ao carregar os hinos.</div>';
  }
}

// Seletor com as categorias principais ("Diversos / X" entra em "Diversos")
async function fetchCategories() {
  try {
    categories = await (await fetch('/api/hymns/categories')).json();
  } catch (err) {
    categories = [];
  }
  const totals = new Map();
  let total = 0;
  categories.forEach(c => {
    total += c.count;
    if (!c.name) return;
    const top = c.name.split(' / ')[0];
    totals.set(top, (totals.get(top) || 0) + c.count);
  });
  if (category && !totals.has(category)) category = null;

  const select = $('hymn-category');
  select.innerHTML = '';
  $('hymn-category-wrap').hidden = totals.size === 0;
  const addOption = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  addOption('', `Todas (${total})`);
  [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).forEach(([name, count]) => addOption(name, `${name} (${count})`));
  select.value = category || '';

  // Sugestões de categoria no editor
  const options = $('hymn-category-options');
  options.innerHTML = '';
  categories.filter(c => c.name).forEach(c => {
    const option = document.createElement('option');
    option.value = c.name;
    options.appendChild(option);
  });
}

function selectCategory(name) {
  category = name;
  $('hymn-category').value = name || '';
  try {
    if (name) localStorage.setItem('amc.hymnCategory', name);
    else localStorage.removeItem('amc.hymnCategory');
  } catch (e) { /* sem armazenamento */ }
  fetchHymnList().then(() => { if (el.search.value.trim()) runSearch(); });
  el.search.focus();
}

export function refreshLibrary() {
  fetchCategories().then(() => fetchHymnList()).then(() => { if (el.search.value.trim()) runSearch(); });
}

function showAll() {
  results = hymnList.map(h => ({ ...h, match: null }));
  focusedIndex = 0;
  renderResults('');
}

async function runSearch() {
  const query = el.search.value.trim();
  if (!query) {
    showAll();
    return;
  }
  const seq = ++searchSeq;
  try {
    const data = await (await fetch(`/api/hymns/search?q=${encodeURIComponent(query)}&limit=15&${categoryParam()}`)).json();
    if (seq !== searchSeq) return; // chegou uma busca mais nova
    lastQuery = query;
    results = data;
    focusedIndex = 0;
    renderResults(query);
  } catch (err) {
    console.error('Erro na busca de hinos:', err);
  }
}

// Escreve o texto destacando as palavras que combinam com a busca
function appendHighlighted(container, text, query) {
  const queryTokens = normalize(query).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  text.split(/(\s+)/).forEach(part => {
    const word = normalize(part).replace(/[^a-z0-9]/g, '');
    const hit = word && queryTokens.some(q => word === q || (q.length >= 3 && word.startsWith(q)));
    if (hit) {
      const mark = document.createElement('mark');
      mark.textContent = part;
      container.appendChild(mark);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

// Com uma categoria escolhida, oferece buscar nas outras (o obreiro pode puxar hino de outro hinário)
function appendSearchEverywhere(query) {
  if (!category || !query) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-text btn-sm search-everywhere';
  btn.textContent = `Procurar "${query}" em todas as categorias`;
  btn.onclick = () => selectCategory(null);
  el.results.appendChild(btn);
}

function renderResults(query) {
  el.results.innerHTML = '';

  if (hymnList.length === 0 && !query) {
    el.results.innerHTML = '<div class="empty">Nenhum hino cadastrado ainda.<br>Use <strong>Novo</strong> ou <strong>Importar</strong>.</div>';
    return;
  }
  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = 'Nenhum hino encontrado.<br>';
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-sm empty-action';
    btn.textContent = 'Cadastrar novo hino';
    btn.onclick = () => openEditor(null);
    empty.appendChild(btn);
    el.results.appendChild(empty);
    appendSearchEverywhere(query);
    return;
  }

  const activeId = state && state.hymn ? state.hymn.id : null;
  results.forEach((hymn, i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'hymn-item';
    item.classList.toggle('active', hymn.id === activeId);
    item.classList.toggle('focused', !!query && i === focusedIndex);
    item.onclick = () => chooseResult(hymn);

    const num = document.createElement('span');
    num.className = 'hymn-num';
    num.textContent = hymn.number || '—';

    const body = document.createElement('span');
    body.className = 'hymn-item-body';
    // Com "Todas", mostra de qual categoria é (o mesmo número existe em vários hinários)
    if (!category && hymn.collection) {
      const tag = document.createElement('span');
      tag.className = 'hymn-category';
      tag.textContent = hymn.collection;
      body.appendChild(tag);
    }
    const title = document.createElement('span');
    title.className = 'hymn-item-title';
    appendHighlighted(title, hymn.title, query);
    body.appendChild(title);

    if (hymn.match) {
      const snippet = document.createElement('span');
      snippet.className = 'hymn-snippet';
      const label = document.createElement('em');
      label.textContent = hymn.match.kind === 'chorus' ? 'Coro' : hymn.match.label ? `Estrofe ${hymn.match.label}` : '';
      if (label.textContent) snippet.appendChild(label);
      appendHighlighted(snippet, hymn.match.line, query);
      body.appendChild(snippet);
    }

    // "+": põe na lista do culto sem abrir o hino
    const add = document.createElement('span');
    add.className = 'hymn-add';
    add.setAttribute('role', 'button');
    add.title = 'Colocar na lista do culto';
    add.textContent = '+';
    add.classList.toggle('added', inPlaylist(hymn.id));
    add.onclick = (e) => {
      e.stopPropagation();
      addToPlaylist(hymn);
    };

    item.append(num, body, add);
    el.results.appendChild(item);
  });
  appendSearchEverywhere(query);
}

function moveFocus(delta) {
  if (results.length === 0) return;
  focusedIndex = (focusedIndex + delta + results.length) % results.length;
  el.results.querySelectorAll('.hymn-item').forEach((item, i) => item.classList.toggle('focused', i === focusedIndex));
  const item = el.results.querySelectorAll('.hymn-item')[focusedIndex];
  if (item) item.scrollIntoView({ block: 'nearest' });
}

// Abre o hino e, se veio de um trecho, deixa aquela estrofe pronta para ir ao ar
function chooseResult(hymn) {
  ws.send('hymn-select', { id: hymn.id, match: hymn.match ? { sectionIndex: hymn.match.sectionIndex, lineIndex: hymn.match.lineIndex } : null });
  el.search.blur(); // libera o Espaço/→ para passar as estrofes
}

// ---------- Estrofes ----------

function renderHymn() {
  const hymn = state && state.hymn;
  const has = !!(hymn && hymn.id);
  const key = has ? `${hymn.id}|${hymn.slides.map(s => s.text).join('¦')}` : '';

  el.title.textContent = has ? hymnName(hymn) : 'Nenhum hino aberto';
  el.meta.textContent = has ? [hymn.collection, `${hymn.slides.length} telas`].filter(Boolean).join(' · ') : 'Busque um hino pelo trecho da letra.';
  el.btnEdit.hidden = !has;
  el.btnDelete.hidden = !has;

  if (key !== renderedKey) {
    renderedKey = key;
    el.slides.innerHTML = '';
    if (!has) {
      el.slides.innerHTML = '<div class="empty">As estrofes do hino aparecem aqui.</div>';
    } else {
      const fragment = document.createDocumentFragment();
      hymn.slides.forEach((slide, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `slide-card ${slide.kind === 'chorus' ? 'is-chorus' : ''}`;
        card.dataset.index = index;
        card.onclick = () => ws.send('hymn-show', { index });

        const label = document.createElement('span');
        label.className = 'slide-label';
        label.textContent = slideName(slide);
        const text = document.createElement('span');
        text.className = 'slide-text';
        text.textContent = slide.text;

        card.append(label, text);
        fragment.appendChild(card);
      });
      el.slides.appendChild(fragment);
      el.slides.scrollTop = 0;
    }
  }
  highlightSlide();
  renderTransport();
}

function highlightSlide() {
  const hymn = state.hymn;
  let current = null;
  el.slides.querySelectorAll('.slide-card').forEach(card => {
    const isCurrent = Number(card.dataset.index) === hymn.slideIndex;
    card.classList.toggle('live', isCurrent && !hymn.isCleared);
    card.classList.toggle('armed', isCurrent && hymn.isCleared && hymn.armed);
    card.classList.toggle('held', isCurrent && hymn.isCleared && !hymn.armed);
    if (isCurrent) current = card;
  });
  if (current) current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderTransport() {
  const hymn = state.hymn;
  const has = !!hymn.id && hymn.slides.length > 0;
  const isLive = has && !hymn.isCleared && hymn.slideIndex !== -1;
  const atStart = hymn.slideIndex === -1;

  el.btnPrev.disabled = !has || hymn.slideIndex <= 0;
  el.btnNext.disabled = !has || (!hymn.armed && !atStart && hymn.slideIndex >= hymn.slides.length - 1);
  el.btnToggle.disabled = !has || atStart;
  el.btnToggleLabel.textContent = isLive ? 'Ocultar' : 'Exibir';
  el.btnToggle.classList.toggle('is-live', isLive);

  let next = null;
  if (has) next = hymn.armed || atStart ? hymn.slides[Math.max(0, hymn.slideIndex)] : hymn.slides[hymn.slideIndex + 1];
  el.nextLabel.textContent = next ? `Próximo · ${slideName(next)}` : 'Próximo';
  el.nextText.textContent = next ? next.text : (has ? 'Fim do hino.' : '—');
}

function onServerState(newState) {
  const previousId = state && state.hymn ? state.hymn.id : null;
  const previousList = state ? state.hymnPlaylist : null;
  state = newState;
  renderHymn();
  renderPlaylist();
  renderPlaylistButtons();
  if (state.hymnPlaylist !== previousList) {
    const ids = new Set(playlist().map(h => h.id));
    el.results.querySelectorAll('.hymn-item').forEach((item, i) => {
      const add = item.querySelector('.hymn-add');
      if (add && results[i]) add.classList.toggle('added', ids.has(results[i].id));
    });
  }
  if (state.hymn.id !== previousId) {
    el.results.querySelectorAll('.hymn-item').forEach((item, i) => {
      item.classList.toggle('active', results[i] && results[i].id === state.hymn.id);
    });
  }
}

// ---------- Editor ----------

function renderEditorPreview() {
  const preview = $('hymn-form-preview');
  const sections = parseLyrics($('hymn-form-lyrics').value);
  preview.innerHTML = '';
  if (sections.length === 0) {
    preview.innerHTML = '<div class="empty">A sequência aparece aqui enquanto você digita.</div>';
    return;
  }

  const order = document.createElement('div');
  order.className = 'seq-chips';
  buildSequence(sections, $('hymn-form-autochorus').checked).forEach((index, i) => {
    if (i > 0) order.appendChild(document.createTextNode('→'));
    const chip = document.createElement('span');
    chip.className = `seq-chip ${sections[index].kind === 'chorus' ? 'is-chorus' : ''}`;
    chip.textContent = sections[index].kind === 'chorus' ? 'Coro' : sections[index].label ? `Estrofe ${sections[index].label}` : 'Letra';
    order.appendChild(chip);
  });
  preview.appendChild(order);

  sections.forEach(section => {
    const card = document.createElement('div');
    card.className = `slide-card static ${section.kind === 'chorus' ? 'is-chorus' : ''}`;
    const label = document.createElement('span');
    label.className = 'slide-label';
    const screens = section.text.split(/\n\s*\n/).length;
    label.textContent = (section.kind === 'chorus' ? 'Coro' : section.label ? `Estrofe ${section.label}` : 'Letra') + (screens > 1 ? ` · ${screens} telas` : '');
    const text = document.createElement('span');
    text.className = 'slide-text';
    text.textContent = section.text;
    card.append(label, text);
    preview.appendChild(card);
  });
}

async function openEditor(id) {
  editingId = id;
  const form = $('hymn-form');
  form.reset();
  $('hymn-form-title').textContent = id ? 'Editar hino' : 'Novo hino';
  $('hymn-form-autochorus').checked = true;
  $('hymn-form-collection').value = category || '';

  if (id) {
    try {
      const hymn = await (await fetch(`/api/hymns/${id}`)).json();
      $('hymn-form-number').value = hymn.number || '';
      $('hymn-form-name').value = hymn.title;
      $('hymn-form-collection').value = hymn.collection || '';
      $('hymn-form-autochorus').checked = hymn.autoChorus;
      $('hymn-form-lyrics').value = hymn.lyrics;
    } catch (err) {
      toast('Não foi possível abrir o hino.', 'error');
      return;
    }
  }
  renderEditorPreview();
  $('hymn-modal').hidden = false;
  (id ? $('hymn-form-lyrics') : $('hymn-form-number')).focus();
}

function setupEditor() {
  const modal = $('hymn-modal');
  const close = () => { modal.hidden = true; };
  setupModalClose(modal, close);

  $('hymn-form-lyrics').oninput = renderEditorPreview;
  $('hymn-form-autochorus').onchange = renderEditorPreview;

  $('hymn-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      number: $('hymn-form-number').value,
      title: $('hymn-form-name').value,
      collection: $('hymn-form-collection').value,
      autoChorus: $('hymn-form-autochorus').checked,
      lyrics: $('hymn-form-lyrics').value
    };
    try {
      const res = await fetch(editingId ? `/api/hymns/${editingId}` : '/api/hymns', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast(editingId ? 'Hino atualizado.' : 'Hino cadastrado.', 'success');
      close();
      refreshLibrary();
      if (!editingId) ws.send('hymn-select', { id: data.id });
    } catch (err) {
      toast(`Erro ao salvar: ${err.message}`, 'error');
    }
  };

  $('btn-hymn-new').onclick = () => openEditor(null);
  el.btnEdit.onclick = () => state && state.hymn.id && openEditor(state.hymn.id);
  el.btnDelete.onclick = async () => {
    const hymn = state && state.hymn;
    if (!hymn || !hymn.id) return;
    const ok = await confirmDialog({
      title: 'Excluir hino?',
      text: `"${hymnName(hymn)}" será removido. Esta ação não pode ser desfeita.`,
      okLabel: 'Excluir',
      danger: true
    });
    if (!ok) return;
    const res = await fetch(`/api/hymns/${hymn.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast('Hino excluído.', 'success');
      refreshLibrary();
    } else {
      toast('Erro ao excluir o hino.', 'error');
    }
  };
}

// ---------- Importação ----------

// Arquivos da igreja são UTF-8; se algum vier do Bloco de Notas antigo (ANSI), lê como Windows-1252
async function readText(file) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (err) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

// Nome do arquivo: "012 - VINDE, POVO DO SENHOR", "003" ou "A ESCOLA DOS PROFETAS"
function parseFileName(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  let match = base.match(/^(\d{1,4})\s*[-–.:)]\s*(.+)$/);
  if (match) return { number: String(parseInt(match[1], 10)), title: match[2].trim() };
  match = base.match(/^(\d{1,4})$/);
  if (match) return { number: String(parseInt(match[1], 10)), title: '' };
  return { number: '', title: base };
}

// Categoria = pastas entre a pasta escolhida e o arquivo ("Harpa Cristã", "Diversos / Salmos e Hinos")
function categoryFromPath(relativePath) {
  const parts = String(relativePath || '').split('/').filter(Boolean);
  return parts.slice(1, -1).join(' / ');
}

// Arquivos arrastados não trazem o caminho da pasta; percorre as pastas soltas na área
// para montar o mesmo caminho que o botão "Escolher pasta" daria ("1 Hinos/Harpa Cristã/x.txt")
async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items].map(item => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
  if (entries.length === 0) return [...dataTransfer.files].map(file => ({ file, path: file.name }));

  const result = [];
  const readAll = (reader) => new Promise((resolve, reject) => {
    const all = [];
    const next = () => reader.readEntries(batch => {
      if (batch.length === 0) resolve(all);
      else { all.push(...batch); next(); }
    }, reject);
    next();
  });
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      result.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  // Uma pasta solta vira a raiz ("1 Hinos/..."); várias pastas soltas viram categorias direto
  const prefix = entries.length > 1 && entries.every(e => e.isDirectory) ? '_/' : '';
  for (const entry of entries) await walk(entry, prefix);
  return result;
}

async function readHymnFile(file, relativePath = file.webkitRelativePath) {
  const text = (await readText(file)).replace(/^﻿/, '');

  if (file.name.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.hymns || [];
    return list.map(h => ({
      number: h.number ?? '',
      title: h.title || '',
      collection: h.collection || h.category || '',
      autoChorus: h.autoChorus !== false,
      lyrics: h.lyrics || (Array.isArray(h.sections) ? h.sections.map(s => s.text).join('\n\n') : '')
    }));
  }

  // .txt no formato da pasta tf_slides: o nome do arquivo é número/título e o arquivo inteiro é a letra.
  // Sem título no nome (ex: "003.txt"), usa a primeira linha da letra.
  const { number, title } = parseFileName(file.name);
  const firstLine = (text.split(/\r?\n/).find(line => /[\p{L}\p{N}]/u.test(line) && line.trim() !== '*') || '').trim();
  return [{
    number,
    title: title || firstLine.replace(/[,;:.!?]+$/, ''),
    collection: categoryFromPath(relativePath),
    autoChorus: false, // nesses arquivos o coro já vem escrito toda vez que se repete
    lyrics: text
  }];
}

function setupImport() {
  const modal = $('hymn-import-modal');
  const folderInput = $('hymn-folder');
  const filesInput = $('hymn-files');
  const summary = $('hymn-import-summary');
  const confirm = $('btn-hymn-import-confirm');
  const dropzone = $('hymn-dropzone');
  let pending = [];

  const close = () => {
    modal.hidden = true;
    folderInput.value = '';
    filesInput.value = '';
    pending = [];
    summary.hidden = true;
    confirm.disabled = true;
    confirm.textContent = 'Importar';
  };
  setupModalClose(modal, close);
  $('btn-hymn-import').onclick = () => { modal.hidden = false; };

  // Recebe [{ file, path }]; o path define a categoria
  const handleFiles = async (items) => {
    let hymnFiles = items.filter(({ file }) => /\.(txt|json)$/i.test(file.name));
    // Escolheu só uma pasta de categoria (ex: "Harpa Cristã", com os .txt direto nela):
    // a própria pasta é a categoria
    if (hymnFiles.some(({ path }) => path.split('/').length === 2)) {
      hymnFiles = hymnFiles.map(({ file, path }) => ({ file, path: `_/${path}` }));
    }
    summary.hidden = false;
    summary.textContent = `Lendo ${hymnFiles.length} arquivos...`;
    pending = [];
    const problems = [];
    for (const { file, path } of hymnFiles) {
      try {
        pending.push(...await readHymnFile(file, path));
      } catch (err) {
        problems.push(path || file.name);
      }
    }
    pending = pending.filter(h => h.title && h.lyrics.trim());

    // Resumo por categoria
    const byCategory = new Map();
    pending.forEach(h => byCategory.set(h.collection || 'Sem categoria', (byCategory.get(h.collection || 'Sem categoria') || 0) + 1));

    summary.innerHTML = '';
    const head = document.createElement('strong');
    head.textContent = `${pending.length} hinos prontos para importar`;
    summary.appendChild(head);
    const list = document.createElement('ul');
    [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).forEach(([name, count]) => {
      const li = document.createElement('li');
      li.textContent = `${name}: ${count}`;
      list.appendChild(li);
    });
    summary.appendChild(list);
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = 'Hinos que já existem (mesmo número, título e categoria) são pulados.';
    summary.appendChild(note);
    if (problems.length) {
      const warn = document.createElement('p');
      warn.className = 'muted small';
      warn.textContent = `Não consegui ler: ${problems.slice(0, 5).join(', ')}${problems.length > 5 ? '...' : ''}`;
      summary.appendChild(warn);
    }
    confirm.disabled = pending.length === 0;
    confirm.textContent = pending.length ? `Importar ${pending.length} hinos` : 'Importar';
  };

  folderInput.onchange = () => handleFiles([...folderInput.files].map(file => ({ file, path: file.webkitRelativePath })));
  filesInput.onchange = () => handleFiles([...filesInput.files].map(file => ({ file, path: file.name })));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragging'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
  // Aceita soltar pastas em qualquer lugar da janela de importação
  modal.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragging'); });
  modal.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
    handleFiles(await filesFromDrop(e.dataTransfer));
  });

  confirm.onclick = async () => {
    confirm.disabled = true;
    confirm.textContent = 'Importando...';
    try {
      const res = await fetch('/api/hymns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hymns: pending })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      let message = `${data.created} hinos importados`;
      if (data.skipped) message += `, ${data.skipped} já existiam`;
      toast(message + '.', 'success');
      if (data.errors.length) toast(`${data.errors.length} com problema: ${data.errors[0]}`, 'error');
      close();
      refreshLibrary();
    } catch (err) {
      toast(`Erro na importação: ${err.message}`, 'error');
      confirm.disabled = false;
      confirm.textContent = 'Tentar de novo';
    }
  };
}

// ---------- Controles ----------

export const hymnControls = {
  next: () => ws.send('next', { mode: 'hymn' }),
  prev: () => ws.send('prev', { mode: 'hymn' }),
  toggle: () => ws.send('toggle-clear', { mode: 'hymn' }),
  focusSearch: () => { setView('search'); el.search.focus(); el.search.select(); }
};

export function setupHymns() {
  ws.on('init', onServerState);
  ws.on('update-content', onServerState);

  $('hymn-category').onchange = (e) => selectCategory(e.target.value || null);

  el.search.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 120);
  };
  el.search.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      const query = el.search.value.trim();
      if (!query) return;
      // Se o texto mudou desde a última busca, busca antes de escolher; senão usa a seta escolhida
      const ready = query === lastQuery ? Promise.resolve() : runSearch();
      ready.then(() => { if (results[focusedIndex]) chooseResult(results[focusedIndex]); });
    }
  };

  el.btnPrev.onclick = hymnControls.prev;
  el.btnNext.onclick = hymnControls.next;
  el.btnToggle.onclick = hymnControls.toggle;

  setupEditor();
  setupImport();
  setupPlaylist();
  refreshLibrary();
}
