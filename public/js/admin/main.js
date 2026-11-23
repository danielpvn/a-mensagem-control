// Ponto de entrada do painel do operador.
import { $, setupTabs, selectTab, getActiveTab, isModalOpen, setupSections, setupAppearanceSwitches, showAppearancePart } from './ui.js';
import * as ws from './ws.js';
import { setupLive } from './live.js';
import { setupMessage, messageControls, fetchSermons } from './message.js';
import { setupHymns, hymnControls, refreshLibrary } from './hymns.js';
import { refreshBackgrounds } from './backgrounds.js';
import { setupCloud } from './cloud.js';
import { setupBible, bibleControls, fetchBooks as refreshBible } from './bible.js';
import { setupBibleAppearance } from './bible-appearance.js';
import { setupMedia, mediaControls } from './media.js';
import { setupLowerThird, toggleLowerThird } from './lowerthird.js';
import { setupPrayer } from './prayer.js';
import { setupReading } from './reading.js';
import { setupBibleFavorites } from './bible-favorites.js';
import { setupSpecial } from './special.js';
import { setupSounds } from './sounds.js';
import { setupAppearance } from './appearance.js';
import { setupHymnAppearance } from './hymn-appearance.js';
import { setupConfig } from './config.js';
import { setupShortcuts, actionForEvent } from './shortcuts.js';
import { setupFeedback } from './feedback.js';
import { fillFontSelects } from './fonts.js';
import { setupNextPreviews, postNext, setNextOverride } from './next-preview.js';
import { announceText, editCurrentLook } from './reading.js';
import { selectedPreacherName } from './lowerthird.js';
import { specialPreviewLines } from './special.js';

// Arrastar na prévia "Como vai ficar" (nome do pregador/louvor, passagem do anúncio):
// o overlay daquele quadro diz o que mudou e o painel manda para o servidor
function setupPreviewEdits() {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.origin !== window.location.origin || !data || data.type !== 'preview-edit' || !data.changes) return;
    if (data.target === 'lt') ws.send('update-lt-styles', data.changes);
    else if (data.target === 'sp') ws.send('update-special-styles', data.changes);
    else if (data.target === 'reading') ws.send('update-reading-styles', data.changes);
    else if (data.target === 'reading-look') editCurrentLook(data.changes);
  });
}

// Prévias: o overlay real do OBS dentro de um iframe, reduzido para caber no painel
function setupStages() {
  document.querySelectorAll('[data-stage]').forEach(stage => {
    const frame = stage.querySelector('iframe');
    const fit = () => {
      frame.style.transform = `scale(${stage.clientWidth / 1920})`;
    };
    new ResizeObserver(fit).observe(stage);
    fit();
  });
}

// Teclado e passador: comandam a aba aberta (Mensagem ou Hinos);
// nas outras abas, comandam o que foi para o ar por último
function setupKeyboard() {
  const controlsForTab = () => {
    const tab = getActiveTab();
    if (tab === 'hinos') return hymnControls;
    if (tab === 'biblia') return bibleControls;
    if (tab === 'midia') return mediaControls;
    if (tab === 'mensagem') return messageControls;
    return null;
  };

  window.addEventListener('keydown', (e) => {
    if (isModalOpen()) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    // As teclas de cada ação vêm de Configurações > Atalhos de teclado
    const controls = controlsForTab();
    const action = actionForEvent(e);
    switch (action) {
      case 'next':
        e.preventDefault();
        if (controls) controls.next();
        else ws.send('next');
        break;
      case 'prev':
        e.preventDefault();
        if (controls) controls.prev();
        else ws.send('prev');
        break;
      case 'toggle':
        e.preventDefault();
        if (controls) controls.toggle();
        else ws.send('toggle-clear');
        break;
      case 'show':
      case 'hide': {
        // Exibir e Ocultar separados (o servidor sabe o que está no ar e o que está preparado)
        e.preventDefault();
        const mode = { mensagem: 'message', hinos: 'hymn', biblia: 'bible', midia: 'media' }[getActiveTab()];
        ws.send(action === 'show' ? 'show-layer' : 'hide-layer', mode ? { mode } : {});
        break;
      }
      case 'clear':
        e.preventDefault();
        ws.send('clear-screen');
        break;
      case 'lowerThird':
        // Nome do pregador: funciona em qualquer aba
        e.preventDefault();
        toggleLowerThird();
        break;
      case 'search':
        if (tag === 'BUTTON' || !controls) return;
        e.preventDefault();
        controls.focusSearch();
        break;
    }
  });
}

ws.onConnectionChange((connected) => {
  const badge = $('ws-status');
  badge.className = `conn ${connected ? 'is-on' : 'is-off'}`;
  badge.title = connected ? 'Conectado ao servidor' : 'Desconectado do servidor. Tentando reconectar...';
  document.body.classList.toggle('offline', !connected);
});

// Chegou novidade do banco online: recarrega as listas que mudaram
ws.on('library-changed', (changed) => {
  if (changed.sermons) fetchSermons();
  if (changed.hymns) refreshLibrary();
  if (changed.backgrounds) refreshBackgrounds();
  if (changed.bible) refreshBible();
});

fillFontSelects(); // antes das abas lerem os valores salvos
setupStages();
setupPreviewEdits();
setupLive(selectTab);
setupMessage();
setupHymns();
setupAppearance();
setupHymnAppearance();
setupBible();
setupBibleAppearance();
setupMedia();
setupLowerThird();
setupPrayer();
setupReading();
setupBibleFavorites(); // depois da leitura: usa a passagem que ela acabou de montar
setupSpecial();
setupSounds();
setupConfig();
setupShortcuts();
setupFeedback();
setupCloud();
setupKeyboard();
setupTabs();
setupSections();
setupAppearanceSwitches();
setupNextPreviews();

// Aba Culto: a segunda prévia mostra a parte escolhida na Aparência (pregador, louvor ou pedidos)
// como vai ficar; sem nada preenchido, usa um exemplo para dar para ver o estilo
const EXAMPLE_NAMES = ['Maria da Silva', 'João Pereira', 'Família Santos', 'Irmã Ana', 'Pedro Henrique', 'Igreja de Formosa'];
function updateCultoNext() {
  const part = (document.querySelector('input[name="culto-look-part"]:checked') || {}).value || 'lt';
  let item;
  if (part === 'prayer') {
    const names = $('prayer-names').value.split(/\r?\n/).map(n => n.trim()).filter(Boolean).slice(0, 40);
    item = { part, title: $('prayer-title').value.trim() || 'Pedidos de oração', names: names.length ? names : EXAMPLE_NAMES };
  } else if (part === 'sp') {
    item = { part, ...specialPreviewLines() };
  } else {
    item = { part, name: selectedPreacherName() || 'Nome do pregador', subtitle: '' };
  }
  postNext('culto', item);
  $('culto-next-label').textContent = { lt: 'Como vai ficar · nome do pregador', sp: 'Como vai ficar · louvor especial', prayer: 'Como vai ficar · pedidos de oração' }[part];
}
// Aba Bíblia: com "Anúncio da leitura" escolhido na Aparência, a segunda prévia mostra o anúncio
// da passagem escolhida (clicar num versículo já troca a passagem)
function updateBibleNext() {
  const reading = (document.querySelector('input[name="bible-look-part"]:checked') || {}).value === 'reading';
  setNextOverride('bible', reading ? { part: 'reading', text: announceText() } : null);
  const label = $('bible-next-label');
  label.textContent = reading ? 'Como vai ficar · anúncio da leitura' : (label.dataset.verse || 'Próximo');
}
setInterval(() => { updateCultoNext(); updateBibleNext(); }, 700);
document.querySelectorAll('input[name="bible-look-part"], input[name="culto-look-part"]').forEach(radio => {
  radio.addEventListener('change', () => { updateCultoNext(); updateBibleNext(); });
});
// Aba Culto: mexer no louvor, nos pedidos ou no pregador já abre a aparência daquela parte
// (na Bíblia, a barra "Leitura" abre a aparência do anúncio)
[['.culto-special', 'sp'], ['.prayer-card', 'prayer'], ['.culto-side', 'lt'], ['#bible-announce', 'reading']].forEach(([selector, part]) => {
  const area = document.querySelector(selector);
  if (area) area.addEventListener('focusin', (e) => {
    // O louvor fica dentro da coluna do pregador: o mais de dentro decide
    if (part === 'lt' && e.target.closest('.culto-special')) return;
    showAppearancePart(part);
  });
});
ws.connect();
