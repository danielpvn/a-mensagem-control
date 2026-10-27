// Aba Bíblia: busca por referência ou palavras, livros e capítulos, versículos ao vivo.
import { $, toast, normalize } from './ui.js';
import * as ws from './ws.js';

let books = [];            // [{ id, name, abbrev, testament, chapters }]
let state = null;          // estado do servidor
let found = null;          // última resposta da busca
let focusedIndex = 0;      // resultado escolhido com ↑ ↓
let browsingBook = null;   // livro aberto na grade de capítulos
let renderedKey = '';
let searchSeq = 0;
let searchTimer = null;
let lastQuery = '';

const el = {
  search: $('bible-search'),
  results: $('bible-results'),
  title: $('bible-title'),
  meta: $('bible-meta'),
  prevChapter: $('btn-bible-prev-chapter'),
  nextChapter: $('btn-bible-next-chapter'),
  verses: $('bible-verses'),
  btnPrev: $('btn-bible-prev'),
  btnNext: $('btn-bible-next'),
  btnToggle: $('btn-bible-toggle'),
  btnToggleLabel: $('btn-bible-toggle-label'),
  nextLabel: $('bible-next-label'),
  nextText: $('bible-next-text')
};

const select = (book, chapter, verse = null) => {
  ws.send('bible-select', { book, chapter, verse });
  el.search.blur(); // libera o Espaço/→ para passar os versículos
};

const verseLabel = (slide) => (slide.parts > 1 ? `${slide.verse} (${slide.part}/${slide.parts})` : String(slide.verse));

// ---------- Livros e capítulos ----------

async function fetchBooks() {
  try {
    const data = await (await fetch('/api/bible/books')).json();
    books = data.books;
    renderStatus(data.verses, data.folder);
    if (!el.search.value.trim()) renderBrowser();
  } catch (err) {
    el.results.innerHTML = '<div class="empty">Erro ao carregar a Bíblia.</div>';
  }
}

function renderStatus(verses, folder) {
  $('bible-status').textContent = verses
    ? `${verses.toLocaleString('pt-BR')} versículos carregados neste computador.`
    : `A Bíblia ainda não foi importada neste computador (não achei ${folder}).`;
}

function renderBrowser() {
  el.results.innerHTML = '';
  if (books.every(b => !b.chapters)) {
    el.results.innerHTML = `
      <div class="empty">A Bíblia ainda não está neste computador.<br>
      Importe a pasta <strong>2 Biblia_ACF</strong> em <strong>Configurações</strong>.</div>`;
    return;
  }

  if (browsingBook) {
    const book = books.find(b => b.id === browsingBook);
    const head = document.createElement('div');
    head.className = 'browser-head';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-text btn-sm';
    back.textContent = '‹ Livros';
    back.onclick = () => { browsingBook = null; renderBrowser(); };
    const name = document.createElement('strong');
    name.textContent = book.name;
    head.append(back, name);
    el.results.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'chapter-grid';
    for (let c = 1; c <= book.chapters; c++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chapter-btn';
      btn.classList.toggle('active', state && state.bible.book === book.id && state.bible.chapter === c);
      btn.textContent = c;
      btn.onclick = () => select(book.id, c);
      grid.appendChild(btn);
    }
    el.results.appendChild(grid);
    return;
  }

  [['VT', 'Antigo Testamento'], ['NT', 'Novo Testamento']].forEach(([testament, label]) => {
    const title = document.createElement('div');
    title.className = 'browser-section';
    title.textContent = label;
    el.results.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'book-grid';
    books.filter(b => b.testament === testament).forEach(book => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'book-btn';
      btn.classList.toggle('active', state && state.bible.book === book.id);
      btn.textContent = book.name;
      btn.onclick = () => { browsingBook = book.id; renderBrowser(); };
      grid.appendChild(btn);
    });
    el.results.appendChild(grid);
  });
}

// ---------- Busca ----------

async function runSearch() {
  const query = el.search.value.trim();
  if (!query) {
    found = null;
    lastQuery = '';
    renderBrowser();
    return;
  }
  const seq = ++searchSeq;
  try {
    const data = await (await fetch(`/api/bible/search?q=${encodeURIComponent(query)}&limit=30`)).json();
    if (seq !== searchSeq) return;
    found = data;
    lastQuery = query;
    focusedIndex = 0;
    renderResults(query);
  } catch (err) {
    console.error('Erro na busca da Bíblia:', err);
  }
}

// Itens que dá para escolher com ↑ ↓ / Enter, na ordem em que aparecem
function choices() {
  if (!found) return [];
  const list = [];
  if (found.reference) list.push({ book: found.reference.book, chapter: found.reference.chapter, verse: found.reference.verse });
  found.results.forEach(r => list.push({ book: r.book, chapter: r.chapter, verse: r.verse }));
  return list;
}

function appendHighlighted(container, text, query) {
  const queryTokens = normalize(query).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  text.split(/(\s+)/).forEach(part => {
    const word = normalize(part).replace(/[^a-z0-9]/g, '');
    if (word && queryTokens.some(q => word === q || (q.length >= 3 && word.startsWith(q)))) {
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
  let index = 0;

  // Referência reconhecida: "Ir para João 3:16"
  if (found.reference) {
    const ref = found.reference;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ref-card';
    card.classList.toggle('focused', focusedIndex === index);
    card.dataset.choice = index++;
    const label = document.createElement('strong');
    label.textContent = ref.label;
    const hint = document.createElement('span');
    hint.className = 'ref-hint';
    hint.textContent = ref.verse ? 'Enter deixa pronto' : 'Enter abre o capítulo';
    card.append(label, hint);
    if (ref.preview) {
      const preview = document.createElement('span');
      preview.className = 'ref-preview';
      preview.textContent = ref.preview;
      card.appendChild(preview);
    }
    card.onclick = () => select(ref.book, ref.chapter, ref.verse);
    el.results.appendChild(card);
  } else if (found.books.length) {
    // Só o livro (ou capítulo que não existe): mostra os capítulos do livro
    const book = books.find(b => b.id === found.books[0].id);
    const typedChapter = (query.match(/\d+\s*$/) || [])[0];
    if (typedChapter && book) {
      const warn = document.createElement('p');
      warn.className = 'muted small';
      warn.textContent = `${book.name} tem ${book.chapters} capítulos.`;
      el.results.appendChild(warn);
    }
    if (found.books.length > 1) {
      const chips = document.createElement('div');
      chips.className = 'book-grid';
      found.books.forEach(b => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'book-btn';
        btn.textContent = b.name;
        btn.onclick = () => { browsingBook = b.id; el.search.value = ''; renderBrowser(); };
        chips.appendChild(btn);
      });
      el.results.appendChild(chips);
    } else if (book) {
      browsingBook = book.id;
      const grid = document.createElement('div');
      grid.className = 'chapter-grid';
      for (let c = 1; c <= book.chapters; c++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chapter-btn';
        btn.textContent = c;
        btn.onclick = () => select(book.id, c);
        grid.appendChild(btn);
      }
      const head = document.createElement('div');
      head.className = 'browser-section';
      head.textContent = book.name;
      el.results.append(head, grid);
    }
  }

  // Versículos encontrados pelas palavras
  found.results.forEach(r => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'verse-result';
    item.classList.toggle('focused', focusedIndex === index);
    item.dataset.choice = index++;
    const label = document.createElement('strong');
    label.textContent = r.label;
    const text = document.createElement('span');
    appendHighlighted(text, r.text, query);
    item.append(label, text);
    item.onclick = () => select(r.book, r.chapter, r.verse);
    el.results.appendChild(item);
  });

  if (!found.reference && found.books.length === 0 && found.results.length === 0) {
    el.results.innerHTML = '<div class="empty">Nada encontrado.<br>Tente uma referência (<em>jo 3 16</em>) ou outras palavras.</div>';
  }
}

function moveFocus(delta) {
  const items = [...el.results.querySelectorAll('[data-choice]')];
  if (items.length === 0) return;
  focusedIndex = (focusedIndex + delta + items.length) % items.length;
  items.forEach(item => item.classList.toggle('focused', Number(item.dataset.choice) === focusedIndex));
  items[focusedIndex].scrollIntoView({ block: 'nearest' });
}

// ---------- Capítulo aberto ----------

function renderChapter() {
  const b = state.bible;
  const has = !!b.book;
  const key = has ? `${b.book}:${b.chapter}:${b.slides.length}` : '';

  el.title.textContent = has ? `${b.bookName} ${b.chapter}` : 'Nenhum capítulo aberto';
  el.meta.textContent = has ? `${b.slides.length ? b.slides[b.slides.length - 1].verse : 0} versículos · capítulo ${b.chapter} de ${b.chapters}` : 'Digite uma referência ou escolha um livro.';
  el.prevChapter.hidden = !has || b.chapter <= 1;
  el.nextChapter.hidden = !has || b.chapter >= b.chapters;

  if (key !== renderedKey) {
    renderedKey = key;
    el.verses.innerHTML = '';
    if (!has) {
      el.verses.innerHTML = '<div class="empty">Os versículos do capítulo aparecem aqui.</div>';
    } else {
      const fragment = document.createDocumentFragment();
      b.slides.forEach((slide, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'p-row';
        row.dataset.index = index;
        // Clicar só prepara; quem põe no ar é o Exibir (ou o Próximo)
        row.onclick = () => ws.send('bible-cue', { index });
        const num = document.createElement('span');
        num.className = 'p-num';
        num.textContent = verseLabel(slide);
        const text = document.createElement('span');
        text.className = 'p-text';
        text.textContent = slide.text;
        row.append(num, text);
        fragment.appendChild(row);
      });
      el.verses.appendChild(fragment);
      el.verses.scrollTop = 0;
    }
  }

  const cue = b.cue ?? -1;
  let current = null;
  el.verses.querySelectorAll('.p-row').forEach(row => {
    const index = Number(row.dataset.index);
    const isCurrent = index === b.slideIndex;
    row.classList.toggle('live', isCurrent && !b.isCleared);
    row.classList.toggle('armed', (isCurrent && b.isCleared && b.armed) || index === cue);
    row.classList.toggle('held', isCurrent && b.isCleared && !b.armed);
    if (index === (cue !== -1 ? cue : b.slideIndex)) current = row;
  });
  if (current) current.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Transporte e "próximo"
  const onAir = !b.isCleared;  // algum versículo na tela (pode ser de outro capítulo)
  const atStart = b.slideIndex === -1;
  const atEnd = b.slideIndex >= b.slides.length - 1 && b.chapter >= b.chapters;
  // Com algo preparado, o botão põe no ar; sem, alterna o que está na tela
  const willHide = onAir && cue === -1;
  el.btnPrev.disabled = !has || (b.slideIndex <= 0 && b.chapter <= 1);
  el.btnNext.disabled = !has || (cue === -1 && !b.armed && !atStart && atEnd);
  el.btnToggle.disabled = !onAir && cue === -1 && (!has || atStart);
  el.btnToggleLabel.textContent = willHide ? 'Ocultar' : 'Exibir';
  el.btnToggle.classList.toggle('is-live', willHide);

  let next = null;
  let nextName = '';
  if (has) {
    next = cue !== -1 ? b.slides[cue] : b.armed || atStart ? b.slides[Math.max(0, b.slideIndex)] : b.slides[b.slideIndex + 1];
    if (next) nextName = `${b.bookName} ${b.chapter}:${verseLabel(next)}`;
    else if (b.chapter < b.chapters) nextName = `${b.bookName} ${b.chapter + 1}:1`;
  }
  el.nextLabel.textContent = nextName ? `Próximo · ${nextName}` : 'Próximo';
  el.nextText.textContent = next ? next.text : (nextName ? 'Começo do próximo capítulo.' : has ? 'Fim do livro.' : '—');
}

function onServerState(newState) {
  const previous = state && state.bible ? `${state.bible.book}:${state.bible.chapter}` : '';
  state = newState;
  renderChapter();
  // Destaca o livro/capítulo atual no navegador de livros
  if (!el.search.value.trim() && previous !== `${state.bible.book}:${state.bible.chapter}`) renderBrowser();
}

// ---------- Importação da pasta ----------

async function importFolder(fileList) {
  const files = [...fileList].filter(f => /\.txt$/i.test(f.name));
  if (files.length === 0) {
    toast('Essa pasta não tem os arquivos da Bíblia (.txt).', 'error');
    return;
  }
  toast(`Lendo ${files.length} capítulos...`);
  const payload = [];
  for (const file of files) payload.push({ path: file.webkitRelativePath || file.name, text: await file.text() });
  try {
    const res = await fetch('/api/bible/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast(`Bíblia importada: ${data.verses.toLocaleString('pt-BR')} versículos.`, 'success');
    fetchBooks();
  } catch (err) {
    toast(`Erro ao importar a Bíblia: ${err.message}`, 'error');
  }
}

// ---------- Controles ----------

export const bibleControls = {
  next: () => ws.send('next', { mode: 'bible' }),
  prev: () => ws.send('prev', { mode: 'bible' }),
  toggle: () => ws.send('toggle-clear', { mode: 'bible' }),
  focusSearch: () => { el.search.focus(); el.search.select(); }
};

export function setupBible() {
  ws.on('init', onServerState);
  ws.on('update-content', onServerState);

  el.search.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 100);
  };
  el.search.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      const query = el.search.value.trim();
      if (!query) return;
      const ready = query === lastQuery ? Promise.resolve() : runSearch();
      ready.then(() => {
        const choice = choices()[focusedIndex];
        if (choice) select(choice.book, choice.chapter, choice.verse);
      });
    }
  };

  el.prevChapter.onclick = () => state && select(state.bible.book, state.bible.chapter - 1);
  el.nextChapter.onclick = () => state && select(state.bible.book, state.bible.chapter + 1);
  el.btnPrev.onclick = bibleControls.prev;
  el.btnNext.onclick = bibleControls.next;
  el.btnToggle.onclick = bibleControls.toggle;
  $('bible-folder').onchange = (e) => importFolder(e.target.files);

  fetchBooks();
}
