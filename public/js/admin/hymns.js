// Aba Hinos: busca por trecho da letra, estrofes, editor e importação.
import { $, toast, confirmDialog, normalize, setupModalClose } from './ui.js';
import * as ws from './ws.js';
import { parseLyrics, buildSequence, slideName } from '../shared/hymn-text.js';

let hymnList = [];        // todos os hinos (para quando a busca está vazia)
let results = [];         // o que está listado agora
let focusedIndex = 0;     // resultado escolhido com ↑ ↓
let state = null;         // estado do servidor
let renderedKey = '';     // evita redesenhar as estrofes sem necessidade
let searchSeq = 0;
let searchTimer = null;
let lastQuery = '';
let editingId = null;

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

// ---------- Busca ----------

async function fetchHymnList() {
  try {
    hymnList = await (await fetch('/api/hymns')).json();
    if (!el.search.value.trim()) showAll();
  } catch (err) {
    el.results.innerHTML = '<div class="empty">Erro ao carregar os hinos.</div>';
  }
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
    const data = await (await fetch(`/api/hymns/search?q=${encodeURIComponent(query)}&limit=15`)).json();
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
    const title = document.createElement('span');
    title.className = 'hymn-item-title';
    appendHighlighted(title, hymn.title, query);
    body.appendChild(title);

    if (hymn.match) {
      const snippet = document.createElement('span');
      snippet.className = 'hymn-snippet';
      const label = document.createElement('em');
      label.textContent = hymn.match.kind === 'chorus' ? 'Coro' : `Estrofe ${hymn.match.label}`;
      snippet.appendChild(label);
      appendHighlighted(snippet, hymn.match.line, query);
      body.appendChild(snippet);
    } else if (hymn.collection) {
      const coll = document.createElement('span');
      coll.className = 'hymn-snippet';
      coll.textContent = hymn.collection;
      body.appendChild(coll);
    }

    item.append(num, body);
    el.results.appendChild(item);
  });
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
  el.meta.textContent = has ? `${hymn.slides.length} telas` : 'Busque um hino pelo trecho da letra.';
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
  state = newState;
  renderHymn();
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
    chip.textContent = sections[index].kind === 'chorus' ? 'Coro' : `Estrofe ${sections[index].label}`;
    order.appendChild(chip);
  });
  preview.appendChild(order);

  sections.forEach(section => {
    const card = document.createElement('div');
    card.className = `slide-card static ${section.kind === 'chorus' ? 'is-chorus' : ''}`;
    const label = document.createElement('span');
    label.className = 'slide-label';
    label.textContent = section.kind === 'chorus' ? 'Coro' : `Estrofe ${section.label}`;
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
      await fetchHymnList();
      if (el.search.value.trim()) runSearch();
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
      await fetchHymnList();
      if (el.search.value.trim()) runSearch();
    } else {
      toast('Erro ao excluir o hino.', 'error');
    }
  };
}

// ---------- Importação ----------

// "12 - Título", "12. Título" ou só "Título"
function splitNumberTitle(line) {
  const match = line.match(/^\s*(\d{1,4})\s*[-–.:)]\s*(.+)$/);
  return match ? { number: match[1], title: match[2].trim() } : { number: '', title: line.trim() };
}

async function readHymnFile(file) {
  const text = (await file.text()).replace(/^﻿/, '');
  if (file.name.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.hymns || [];
    return list.map(h => ({
      number: h.number ?? '',
      title: h.title || '',
      collection: h.collection || '',
      lyrics: h.lyrics || (Array.isArray(h.sections) ? h.sections.map(s => s.text).join('\n\n') : '')
    }));
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const firstIndex = lines.findIndex(l => l.trim());
  if (firstIndex === -1) return [];
  const fromTitle = splitNumberTitle(lines[firstIndex]);
  const fromName = splitNumberTitle(file.name.replace(/\.txt$/i, ''));
  return [{
    number: fromTitle.number || fromName.number,
    title: fromTitle.title || fromName.title,
    lyrics: lines.slice(firstIndex + 1).join('\n')
  }];
}

function setupImport() {
  const modal = $('hymn-import-modal');
  const input = $('hymn-files');
  const summary = $('hymn-import-summary');
  const confirm = $('btn-hymn-import-confirm');
  const dropzone = $('hymn-dropzone');
  let pending = [];

  const close = () => {
    modal.hidden = true;
    input.value = '';
    pending = [];
    summary.hidden = true;
    confirm.disabled = true;
  };
  setupModalClose(modal, close);
  $('btn-hymn-import').onclick = () => { modal.hidden = false; };

  const handleFiles = async (files) => {
    pending = [];
    const problems = [];
    for (const file of files) {
      try {
        pending.push(...await readHymnFile(file));
      } catch (err) {
        problems.push(file.name);
      }
    }
    pending = pending.filter(h => h.title && h.lyrics.trim());
    summary.hidden = false;
    summary.innerHTML = '';
    const head = document.createElement('strong');
    head.textContent = `${pending.length} hinos prontos para importar`;
    summary.appendChild(head);
    const list = document.createElement('ul');
    pending.slice(0, 8).forEach(h => {
      const li = document.createElement('li');
      li.textContent = h.number ? `${h.number} · ${h.title}` : h.title;
      list.appendChild(li);
    });
    if (pending.length > 8) {
      const li = document.createElement('li');
      li.textContent = `e mais ${pending.length - 8}...`;
      list.appendChild(li);
    }
    summary.appendChild(list);
    if (problems.length) {
      const warn = document.createElement('p');
      warn.className = 'muted small';
      warn.textContent = `Não consegui ler: ${problems.join(', ')}`;
      summary.appendChild(warn);
    }
    confirm.disabled = pending.length === 0;
  };

  input.onchange = () => handleFiles([...input.files]);
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragging'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
    handleFiles([...e.dataTransfer.files]);
  });

  confirm.onclick = async () => {
    confirm.disabled = true;
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
      fetchHymnList();
    } catch (err) {
      toast(`Erro na importação: ${err.message}`, 'error');
      confirm.disabled = false;
    }
  };
}

// ---------- Controles ----------

export const hymnControls = {
  next: () => ws.send('next', { mode: 'hymn' }),
  prev: () => ws.send('prev', { mode: 'hymn' }),
  toggle: () => ws.send('toggle-clear', { mode: 'hymn' }),
  focusSearch: () => { el.search.focus(); el.search.select(); }
};

export function setupHymns() {
  ws.on('init', onServerState);
  ws.on('update-content', onServerState);

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
  fetchHymnList();
}
