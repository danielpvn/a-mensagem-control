// Aba Mensagem: biblioteca, leitura dos parágrafos, prévia e "continuar de onde parou".
import { $, toast, confirmDialog, normalize, formatDay, setupModalClose } from './ui.js';
import * as ws from './ws.js';

let sermons = [];          // lista da biblioteca
let sermon = null;         // mensagem aberta (com parágrafos já divididos)
let state = null;          // estado do servidor (o que está no ar)
let loadingId = null;
let paragraphQuery = '';
let resumeDismissedFor = null;
let lastListKey = '';

const el = {
  sermonSearch: $('sermon-search'),
  sermonList: $('sermon-list'),
  readerTitle: $('reader-title'),
  readerMeta: $('reader-meta'),
  btnDelete: $('btn-delete-sermon'),
  resume: $('resume-banner'),
  resumeTitle: $('resume-title'),
  resumeSub: $('resume-sub'),
  btnResume: $('btn-resume'),
  paragraphSearch: $('paragraph-search'),
  list: $('paragraphs-list'),
  btnPrev: $('btn-prev'),
  btnNext: $('btn-next'),
  btnToggle: $('btn-toggle'),
  btnToggleLabel: $('btn-toggle-label'),
  nextLabel: $('next-label'),
  nextText: $('next-text')
};

// ---------- Biblioteca ----------

export async function fetchSermons() {
  try {
    const res = await fetch('/api/sermons');
    sermons = await res.json();
    renderSermonList();
  } catch (err) {
    el.sermonList.innerHTML = '<div class="empty">Erro ao carregar as mensagens.</div>';
  }
}

function renderSermonList() {
  const query = normalize(el.sermonSearch.value.trim());
  const filtered = sermons.filter(s => !query || normalize(`${s.title} ${s.date} ${s.id}`).includes(query));

  el.sermonList.innerHTML = '';
  if (sermons.length === 0) {
    el.sermonList.innerHTML = '<div class="empty">Nenhuma mensagem ainda.<br>Clique em <strong>Importar</strong> para adicionar.</div>';
    return;
  }
  if (filtered.length === 0) {
    el.sermonList.innerHTML = '<div class="empty">Nenhuma mensagem encontrada.</div>';
    return;
  }

  filtered.forEach(s => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sermon-item';
    item.classList.toggle('active', !!state && s.id === state.activeSermonId);
    item.onclick = () => chooseSermon(s.id);

    const title = document.createElement('span');
    title.className = 'sermon-item-title';
    title.textContent = s.title;

    const meta = document.createElement('span');
    meta.className = 'sermon-item-meta';
    meta.textContent = `${s.date || 'Sem data'} · ${s.paragraphCount} partes`;

    item.append(title, meta);

    if (s.progress) {
      const progress = document.createElement('span');
      progress.className = 'sermon-item-progress';
      progress.textContent = `Parou no § ${s.progress.paragraphNumber} · ${formatDay(s.progress.updatedAt)}`;
      item.appendChild(progress);
    }
    el.sermonList.appendChild(item);
  });
}

async function chooseSermon(id) {
  if (state && state.activeSermonId === id) return;
  if (state && !state.isCleared) {
    const ok = await confirmDialog({
      title: 'Trocar de mensagem?',
      text: 'O parágrafo que está no ar será retirado da tela.',
      okLabel: 'Trocar'
    });
    if (!ok) return;
  }
  ws.send('select-sermon', { id });
}

async function loadSermon(id) {
  loadingId = id;
  try {
    const res = await fetch(`/api/sermons/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    if (loadingId !== id) return; // outra mensagem foi escolhida enquanto carregava
    sermon = data;
    paragraphQuery = '';
    el.paragraphSearch.value = '';
    renderReader();
  } catch (err) {
    toast('Não foi possível abrir esta mensagem.', 'error');
  }
}

function unloadSermon() {
  sermon = null;
  loadingId = null;
  renderReader();
}

// ---------- Leitura ----------

function renderReader() {
  const hasSermon = !!sermon;
  el.readerTitle.textContent = hasSermon ? sermon.title : 'Nenhuma mensagem aberta';
  el.readerMeta.textContent = hasSermon
    ? `${sermon.date || 'Sem data'} · ${sermon.paragraphs.length} partes para exibir`
    : 'Escolha uma mensagem na lista ao lado.';
  el.btnDelete.hidden = !hasSermon;
  el.paragraphSearch.disabled = !hasSermon;
  renderParagraphs();
  renderResumeBanner();
  renderLiveState();

  // Abre no topo, ou já mostrando onde a leitura parou
  el.list.scrollTop = 0;
  const focusRow = el.list.querySelector('.p-row.live, .p-row.armed, .p-row.held') || (!el.resume.hidden && el.list.querySelector('.p-row.bookmark'));
  if (focusRow) focusRow.scrollIntoView({ block: 'center' });
}

// Número base do parágrafo: "54 (2/3)" -> "54"
const baseNumber = (number) => String(number ?? '').split(' ')[0];

function filteredParagraphs() {
  const all = sermon.paragraphs.map((p, index) => ({ ...p, index }));
  const query = normalize(paragraphQuery.trim());
  if (!query) return all;
  if (/^\d+$/.test(query)) {
    const exact = all.filter(p => baseNumber(p.number) === query);
    return exact.length ? exact : all.filter(p => baseNumber(p.number).startsWith(query));
  }
  return all.filter(p => normalize(p.text).includes(query));
}

function renderParagraphs() {
  el.list.innerHTML = '';
  if (!sermon) {
    el.list.innerHTML = '<div class="empty">Nenhuma mensagem aberta.</div>';
    return;
  }
  if (sermon.paragraphs.length === 0) {
    el.list.innerHTML = '<div class="empty">Esta mensagem não possui parágrafos.</div>';
    return;
  }

  const rows = filteredParagraphs();
  if (rows.length === 0) {
    el.list.innerHTML = '<div class="empty">Nenhum parágrafo encontrado.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  const bookmark = sermon.progress ? sermon.progress.paragraphIndex : -1;
  rows.forEach(p => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'p-row';
    row.dataset.index = p.index;
    row.onclick = () => ws.send('show-paragraph', { index: p.index });
    if (p.index === bookmark) row.classList.add('bookmark');

    const num = document.createElement('span');
    num.className = 'p-num';
    num.textContent = p.number ?? '';

    const text = document.createElement('span');
    text.className = 'p-text';
    text.textContent = p.text;

    row.append(num, text);
    fragment.appendChild(row);
  });
  el.list.appendChild(fragment);
  highlightCurrentRow(false);
}

function highlightCurrentRow(scroll = true) {
  const current = state ? state.currentParagraphIndex : -1;
  el.list.querySelectorAll('.p-row').forEach(row => {
    const isCurrent = Number(row.dataset.index) === current;
    row.classList.toggle('live', isCurrent && !state.isCleared);
    row.classList.toggle('armed', isCurrent && state.isCleared && state.armed);
    row.classList.toggle('held', isCurrent && state.isCleared && !state.armed);
  });
  const row = el.list.querySelector(`.p-row[data-index="${current}"]`);
  if (row && scroll) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderResumeBanner() {
  const progress = sermon && sermon.progress;
  const untouched = state && state.currentParagraphIndex === -1;
  if (!progress || !untouched || resumeDismissedFor === sermon.id) {
    el.resume.hidden = true;
    return;
  }
  const nextIndex = progress.paragraphIndex + 1;
  const next = sermon.paragraphs[nextIndex];
  el.resumeTitle.textContent = `A última leitura parou no § ${progress.paragraphNumber}`;
  el.resumeSub.textContent = formatDay(progress.updatedAt);
  if (next) {
    el.btnResume.textContent = `Continuar do § ${next.number}`;
    el.btnResume.onclick = () => {
      ws.send('arm-paragraph', { index: nextIndex });
      el.resume.hidden = true;
    };
    el.btnResume.hidden = false;
  } else {
    el.resumeSub.textContent += ' · mensagem concluída';
    el.btnResume.hidden = true;
  }
  el.resume.hidden = false;
}

// ---------- Estado ao vivo ----------

function renderLiveState() {
  const hasSermon = !!sermon;
  const index = state ? state.currentParagraphIndex : -1;
  const total = hasSermon ? sermon.paragraphs.length : 0;
  const isLive = !!state && !state.isCleared && index !== -1;
  const isArmed = !!state && state.armed && index !== -1;

  el.btnPrev.disabled = !hasSermon || index <= 0;
  el.btnNext.disabled = !hasSermon || (!isArmed && index >= total - 1);
  el.btnToggle.disabled = !hasSermon || index === -1;
  el.btnToggleLabel.textContent = isLive ? 'Ocultar' : 'Exibir';
  el.btnToggle.classList.toggle('is-live', isLive);

  // O que vem a seguir, para o operador se antecipar
  let next = null;
  if (hasSermon) next = isArmed ? sermon.paragraphs[index] : sermon.paragraphs[index + 1];
  el.nextLabel.textContent = next ? `Próximo · § ${next.number}` : 'Próximo';
  el.nextText.textContent = next ? next.text : (hasSermon && index >= total - 1 ? 'Fim da mensagem.' : '—');
}

function onServerState(newState) {
  const previousIndex = state ? state.currentParagraphIndex : -1;
  state = newState;

  if (state.activeSermonId && (!sermon || sermon.id !== state.activeSermonId) && loadingId !== state.activeSermonId) {
    loadSermon(state.activeSermonId);
  } else if (!state.activeSermonId && sermon) {
    unloadSermon();
  }

  // Mantém o "parou no §" da biblioteca atualizado enquanto o pastor lê
  const item = sermons.find(s => s.id === state.activeSermonId);
  if (item && !state.isCleared && state.currentParagraphIndex !== -1) {
    item.progress = {
      paragraphIndex: state.currentParagraphIndex,
      paragraphNumber: state.currentParagraphNumber,
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };
  }

  // Redesenha a biblioteca só quando muda algo nela (evita pular a rolagem a cada parágrafo)
  const listKey = `${state.activeSermonId}|${item && item.progress ? item.progress.paragraphIndex : ''}`;
  if (listKey !== lastListKey) {
    lastListKey = listKey;
    renderSermonList();
  }
  if (sermon) {
    highlightCurrentRow(state.currentParagraphIndex !== previousIndex);
    renderResumeBanner();
  }
  renderLiveState();
}

// ---------- Ações ----------

const next = () => ws.send('next', { mode: 'message' });
const prev = () => ws.send('prev', { mode: 'message' });
const toggle = () => ws.send('toggle-clear', { mode: 'message' });

// Usado pelo teclado (main.js) quando a aba Mensagem está aberta
export const messageControls = {
  next,
  prev,
  toggle,
  focusSearch: () => el.paragraphSearch.focus()
};

function goToFirstMatch() {
  const rows = sermon ? filteredParagraphs() : [];
  if (rows.length === 0) return;
  ws.send('show-paragraph', { index: rows[0].index });
  paragraphQuery = '';
  el.paragraphSearch.value = '';
  renderParagraphs();
  el.paragraphSearch.blur();
}

async function deleteCurrentSermon() {
  if (!sermon) return;
  const ok = await confirmDialog({
    title: 'Excluir mensagem?',
    text: `"${sermon.title}" será removida da biblioteca. Esta ação não pode ser desfeita.`,
    okLabel: 'Excluir',
    danger: true
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/sermons/${encodeURIComponent(sermon.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toast('Mensagem excluída.', 'success');
    unloadSermon();
    fetchSermons();
  } catch (err) {
    toast(`Erro ao excluir: ${err.message}`, 'error');
  }
}

// ---------- Importação ----------

function setupImport() {
  const modal = $('import-modal');
  const form = $('import-form');
  const text = $('import-text');
  const count = $('import-count');

  const close = () => {
    modal.hidden = true;
    form.reset();
    count.textContent = '';
  };
  setupModalClose(modal, close);

  $('btn-open-import').onclick = () => {
    modal.hidden = false;
    $('import-title').focus();
  };

  // Conta quantos parágrafos numerados foram detectados enquanto cola
  text.oninput = () => {
    const found = text.value.split('\n').filter(line => /^\s*\[?\d+\]?[\s.-]+\S/.test(line)).length;
    count.textContent = found ? `${found} parágrafos numerados encontrados` : '';
  };

  const submit = async (overwrite) => {
    const body = {
      title: $('import-title').value.trim(),
      date: $('import-date').value.trim(),
      rawText: text.value,
      overwrite
    };
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();

    if (res.status === 409) {
      const ok = await confirmDialog({
        title: 'Essa mensagem já existe',
        text: `Já existe uma mensagem chamada "${body.title}". Deseja substituí-la pelo texto novo?`,
        okLabel: 'Substituir',
        danger: true
      });
      if (ok) return submit(true);
      return;
    }
    if (!result.success) throw new Error(result.error);

    toast(`Mensagem salva: ${result.paragraphCount} partes.`, 'success');
    close();
    await fetchSermons();
    if (state && state.activeSermonId === result.id) {
      loadSermon(result.id); // substituiu a mensagem que já estava aberta
    } else {
      chooseSermon(result.id);
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await submit(false);
    } catch (err) {
      toast(`Erro na importação: ${err.message}`, 'error');
    }
  };
}

export function setupMessage() {
  ws.on('init', onServerState);
  ws.on('update-content', onServerState);

  el.sermonSearch.oninput = renderSermonList;
  el.btnPrev.onclick = prev;
  el.btnNext.onclick = next;
  el.btnToggle.onclick = toggle;
  el.btnDelete.onclick = deleteCurrentSermon;
  $('btn-resume-dismiss').onclick = () => {
    resumeDismissedFor = sermon && sermon.id;
    el.resume.hidden = true;
  };

  el.paragraphSearch.oninput = () => {
    paragraphQuery = el.paragraphSearch.value;
    renderParagraphs();
    if (paragraphQuery) el.list.scrollTop = 0;
  };
  el.paragraphSearch.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      goToFirstMatch();
    }
  };

  setupImport();
  fetchSermons();
}
