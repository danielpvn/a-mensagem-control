// Overlay do OBS / Telão: camada da Mensagem (caixa no rodapé) e camada dos Hinos.
import { slideName } from './js/shared/hymn-text.js';

const wsUrl = `ws://${window.location.host}`;
const reconnectInterval = 3000;

// DOM Elements
const overlayContainer = document.getElementById('overlay-container');
const overlayBox = document.getElementById('overlay-box');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');

const hymnLayer = document.getElementById('hymn-layer');
const hymnBox = document.getElementById('hymn-box');
const hymnTitle = document.getElementById('hymn-title');
const hymnText = document.getElementById('hymn-text');
const hymnLabel = document.getElementById('hymn-label');

const ANIMATION_CLASSES = ['anim-slide-up', 'anim-slide-side', 'anim-slide-down', 'anim-fade', 'anim-fade-slow', 'anim-clip-reveal', 'anim-zoom-in', 'anim-blur'];

// Tempo de saída de cada transição antes de trocar o texto
function transitionTimeout(animationType) {
  if (animationType === 'fade-slow') return 600;
  if (animationType === 'blur') return 350;
  return 300;
}

function outlineShadow(color, size) {
  return `-${size}px -${size}px 0 ${color}, ${size}px -${size}px 0 ${color}, -${size}px ${size}px 0 ${color}, ${size}px ${size}px 0 ${color}, 0px 2px 4px rgba(0,0,0,0.5)`;
}

// ================= Mensagem =================

let styleConfig = {};
let activeSermonTitle = '';
let currentParagraphNumber = null;
let currentParagraphText = '';
let isCleared = true;

// Update text content with nice out-and-in animation
function updateContent(useTransition = true) {
  if (isCleared) {
    overlayBox.classList.add('hidden');
    return;
  }

  const showTitle = styleConfig.showTitle !== false;
  const showNum = styleConfig.showParagraphNumber !== false;
  let titleStr = '';

  if (activeSermonTitle && showTitle && showNum && currentParagraphNumber) {
    titleStr = `${activeSermonTitle} - Parágrafo ${currentParagraphNumber}`;
  } else if (activeSermonTitle && showTitle) {
    titleStr = activeSermonTitle;
  } else if (showNum && currentParagraphNumber) {
    titleStr = `Parágrafo ${currentParagraphNumber}`;
  }

  const render = () => {
    overlayTitle.textContent = titleStr;
    overlayText.textContent = currentParagraphText;
    overlayTitle.style.display = titleStr ? 'block' : 'none';
    overlayBox.classList.remove('hidden');
  };

  if (useTransition && !overlayBox.classList.contains('hidden')) {
    // Já visível: esconde, troca o texto e mostra de novo para uma transição suave
    overlayBox.classList.add('hidden');
    setTimeout(render, transitionTimeout(styleConfig.animationType));
  } else {
    render();
  }
}

// Apply styles dynamically
function applyStyles() {
  if (!styleConfig) return;

  overlayBox.style.fontFamily = styleConfig.fontFamily;
  overlayText.style.fontSize = styleConfig.fontSize;
  overlayTitle.style.fontSize = styleConfig.titleSize || '0.85rem';
  overlayBox.style.textAlign = styleConfig.alignment === 'center' ? 'center' : 'left';

  overlayText.style.color = styleConfig.textColor;
  overlayTitle.style.color = styleConfig.accentColor;
  overlayBox.style.borderColor = styleConfig.accentColor;

  if (styleConfig.textOutline) {
    const oColor = styleConfig.outlineColor || '#000000';
    overlayText.style.textShadow = outlineShadow(oColor, 1.5);
    overlayTitle.style.textShadow = outlineShadow(oColor, 1);
  } else {
    overlayText.style.textShadow = 'none';
    overlayTitle.style.textShadow = 'none';
  }

  if (styleConfig.telaoMode) {
    overlayContainer.classList.add('telao-mode');
    overlayBox.style.background = '#000000';
  } else {
    overlayContainer.classList.remove('telao-mode');
    overlayBox.style.background = styleConfig.bgColor;
  }

  overlayBox.classList.remove(...ANIMATION_CLASSES);
  overlayBox.classList.add(`anim-${styleConfig.animationType || 'slide-up'}`);

  if (!isCleared) {
    updateContent(false);
  }
}

// ================= Hinos =================

let hymnStyles = {};
let hymn = null;
let shownHymnKey = null;

// Diminui a letra até caber na área (estrofes longas não podem sair da tela)
function fitHymnText() {
  const base = parseFloat(hymnStyles.fontSize) || 4.2;
  const maxHeight = hymnStyles.layout === 'lower-third' ? window.innerHeight * 0.3 : window.innerHeight * 0.7;
  const maxWidth = hymnText.parentElement.clientWidth;
  let size = base;
  hymnText.style.fontSize = `${size}rem`;
  for (let i = 0; i < 14 && (hymnText.scrollHeight > maxHeight || hymnText.scrollWidth > maxWidth + 1); i++) {
    size *= 0.92;
    hymnText.style.fontSize = `${size}rem`;
  }
}

function renderHymnSlide(slide) {
  const showTitle = hymnStyles.showTitle !== false && hymn.title;
  hymnTitle.textContent = showTitle ? (hymn.number ? `${hymn.number} · ${hymn.title}` : hymn.title) : '';
  hymnTitle.style.display = showTitle ? 'block' : 'none';
  hymnLabel.textContent = hymnStyles.showLabel !== false ? slideName(slide) : '';
  hymnLabel.style.display = hymnStyles.showLabel !== false ? 'block' : 'none';
  hymnText.textContent = slide.text;
  fitHymnText();
}

function updateHymn(useTransition = true) {
  const slide = hymn && !hymn.isCleared ? hymn.slides[hymn.slideIndex] : null;

  if (!slide) {
    hymnLayer.classList.add('hidden');
    shownHymnKey = null;
    return;
  }

  const key = `${hymn.id}:${hymn.slideIndex}:${slide.text}`;
  const layerWasHidden = hymnLayer.classList.contains('hidden');

  if (layerWasHidden || !useTransition) {
    renderHymnSlide(slide);
    hymnBox.classList.remove('hidden');
    hymnLayer.classList.remove('hidden');
  } else if (key !== shownHymnKey) {
    // Troca de estrofe: o fundo fica, só o texto faz a transição
    hymnBox.classList.add('hidden');
    setTimeout(() => {
      renderHymnSlide(slide);
      hymnBox.classList.remove('hidden');
    }, transitionTimeout(hymnStyles.animationType));
  }
  shownHymnKey = key;
}

function applyHymnStyles() {
  const lower = hymnStyles.layout === 'lower-third';
  hymnLayer.classList.toggle('layout-lower', lower);
  hymnLayer.classList.toggle('layout-full', !lower);

  // Na tela cheia o fundo cobre a tela toda; na faixa, só a caixa
  hymnLayer.style.background = lower ? 'transparent' : hymnStyles.bgColor;
  hymnBox.style.background = lower ? hymnStyles.bgColor : 'transparent';

  hymnBox.style.fontFamily = hymnStyles.fontFamily;
  hymnText.style.color = hymnStyles.textColor;
  hymnText.style.textTransform = hymnStyles.uppercase ? 'uppercase' : 'none';
  hymnTitle.style.color = hymnStyles.accentColor;
  hymnLabel.style.color = hymnStyles.accentColor;
  hymnBox.style.borderColor = hymnStyles.accentColor;

  const shadow = hymnStyles.textOutline ? outlineShadow(hymnStyles.outlineColor || '#000000', 2) : '0 3px 10px rgba(0,0,0,0.45)';
  hymnText.style.textShadow = shadow;

  hymnBox.classList.remove(...ANIMATION_CLASSES);
  hymnBox.classList.add(`anim-${hymnStyles.animationType || 'fade'}`);

  if (hymn && !hymn.isCleared && hymn.slides[hymn.slideIndex]) {
    renderHymnSlide(hymn.slides[hymn.slideIndex]);
  }
}

// ================= Conexão =================

function applyState(state, useTransition) {
  activeSermonTitle = state.activeSermonTitle;
  currentParagraphNumber = state.currentParagraphNumber;
  currentParagraphText = state.currentParagraphText;
  isCleared = state.isCleared;
  updateContent(useTransition);

  hymn = state.hymn || null;
  updateHymn(useTransition);
}

function connect() {
  const ws = new WebSocket(wsUrl);

  ws.onclose = () => {
    setTimeout(connect, reconnectInterval);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'init':
          styleConfig = data.payload.styles;
          hymnStyles = data.payload.hymnStyles || {};
          applyStyles();
          applyHymnStyles();
          applyState(data.payload, false); // sem transição ao conectar
          break;

        case 'update-content':
          applyState(data.payload, true);
          break;

        case 'update-style':
          styleConfig = { ...styleConfig, ...data.payload };
          applyStyles();
          break;

        case 'update-hymn-style':
          hymnStyles = { ...hymnStyles, ...data.payload };
          applyHymnStyles();
          break;
      }
    } catch (err) {
      console.error('Erro ao processar mensagem do WebSocket:', err);
    }
  };
}

connect();
