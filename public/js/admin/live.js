// O que está no ar agora: chip do topo, selos das prévias e botão "Limpar tela".
import { $ } from './ui.js';
import * as ws from './ws.js';
import { slideName } from '../shared/hymn-text.js';

// Resume o estado do servidor em { kind: 'live' | 'armed' | 'off', label, tab }
export function describeLive(state) {
  const hymn = state.hymn || {};
  const slide = hymn.slides ? hymn.slides[hymn.slideIndex] : null;
  const hymnName = hymn.number ? `Hino ${hymn.number}` : hymn.title;
  const messageReady = state.currentParagraphIndex !== -1;
  const bible = state.bible || {};
  const verse = bible.slides ? bible.slides[bible.slideIndex] : null;
  const verseName = verse ? `${bible.bookName} ${bible.chapter}:${verse.verse}` : '';

  const m = state.media || {};
  const item = m.items ? m.items[m.index] : null;

  if (item && !m.isCleared) return { kind: 'live', label: `No ar · ${item.type === 'video' ? 'Vídeo' : 'Imagem'}: ${item.name}`, badge: 'Mídia no ar', tab: 'midia' };
  if (verse && !bible.isCleared) return { kind: 'live', label: `No ar · ${verseName}`, badge: 'Bíblia no ar', tab: 'biblia' };
  if (slide && !hymn.isCleared) return { kind: 'live', label: `No ar · ${hymnName} · ${slideName(slide)}`, badge: 'Hino no ar', tab: 'hinos' };
  if (messageReady && !state.isCleared) return { kind: 'live', label: `No ar · § ${state.currentParagraphNumber}`, badge: 'Mensagem no ar', tab: 'mensagem' };
  if (slide && hymn.armed) return { kind: 'armed', label: `Pronto · ${hymnName} · ${slideName(slide)}`, badge: 'Hino pronto', tab: 'hinos' };
  if (item && m.armed) return { kind: 'armed', label: `Pronto · ${item.name}`, badge: 'Mídia pronta', tab: 'midia' };
  if (verse && bible.armed) return { kind: 'armed', label: `Pronto · ${verseName}`, badge: 'Bíblia pronta', tab: 'biblia' };
  if (messageReady && state.armed) return { kind: 'armed', label: `Pronto · § ${state.currentParagraphNumber}`, badge: 'Mensagem pronta', tab: 'mensagem' };
  return { kind: 'off', label: 'Tela limpa', badge: 'Tela limpa', tab: null };
}

export function setupLive(selectTab) {
  const chip = $('live-chip');
  let target = null;

  const render = (state) => {
    const live = describeLive(state);
    target = live.tab;
    chip.className = `live-chip is-${live.kind === 'live' ? 'live' : live.kind === 'armed' ? 'armed' : 'off'}`;
    chip.style.cursor = target ? 'pointer' : 'default';
    $('live-label').textContent = live.label;
    document.querySelectorAll('[data-monitor-badge]').forEach(badge => {
      badge.className = `badge ${live.kind === 'live' ? 'badge-live' : live.kind === 'armed' ? 'badge-armed' : 'badge-off'}`;
      badge.textContent = live.badge;
    });
  };

  ws.on('init', render);
  ws.on('update-content', render);

  // Clicar no chip leva para a aba do que está no ar
  chip.onclick = () => { if (target) selectTab(target); };
  $('btn-panic').onclick = () => ws.send('clear-screen');
}
