// WebSocket connection
let ws;
let wsUrl = `ws://${window.location.host}`;
let reconnectInterval = 3000;

// State management
let sermonsList = [];
let currentSermon = null;
let currentParagraphs = [];
let activeParagraphIndex = -1;
let isCleared = true;
let currentSearchQuery = '';

// Style config state (loaded from server init)
let styleConfig = {};

// DOM Elements
const wsStatus = document.getElementById('ws-status');
const sermonSelect = document.getElementById('sermon-select');
const activeSermonDetails = document.getElementById('active-sermon-details');
const detailsTitle = document.getElementById('details-title');
const detailsDate = document.getElementById('details-date');
const detailsCount = document.getElementById('details-count');

const paragraphsList = document.getElementById('paragraphs-list');
const paragraphSearch = document.getElementById('paragraph-search');

const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnClear = document.getElementById('btn-clear');

const monitorOverlayBox = document.getElementById('monitor-overlay-box');
const monitorTitle = document.getElementById('monitor-title');
const monitorText = document.getElementById('monitor-text');
const monitorClearedBadge = document.getElementById('monitor-cleared-badge');

// Style inputs
const styleFont = document.getElementById('style-font');
const styleSizeSlider = document.getElementById('style-size-slider');
const sizeSliderVal = document.getElementById('size-slider-val');
const styleTitleSizeSlider = document.getElementById('style-title-size-slider');
const titleSizeSliderVal = document.getElementById('title-size-slider-val');
const styleAnimation = document.getElementById('style-animation');
const styleTextColor = document.getElementById('style-text-color');
const styleAccentColor = document.getElementById('style-accent-color');
const styleBgColorPicker = document.getElementById('style-bg-color-picker');
const styleBgOpacity = document.getElementById('style-bg-opacity');
const opacityVal = document.getElementById('opacity-val');
const styleShowTitle = document.getElementById('style-show-title');
const styleTelaoMode = document.getElementById('style-telao-mode');
const styleTextOutline = document.getElementById('style-text-outline');
const styleOutlineColor = document.getElementById('style-outline-color');
const btnResetStyles = document.getElementById('btn-reset-styles');

// Modal Elements
const importModal = document.getElementById('import-modal');
const btnOpenImport = document.getElementById('btn-open-import');
const btnCloseImport = document.getElementById('btn-close-import');
const btnCancelImport = document.getElementById('btn-cancel-import');
const importForm = document.getElementById('import-form');

// Connect to WebSockets
function connectWebSocket() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Conectado ao servidor.');
    wsStatus.textContent = 'Conectado';
    wsStatus.className = 'status-badge connected';
    ws.send(JSON.stringify({ type: 'register-admin' }));
  };

  ws.onclose = () => {
    console.log('Desconectado. Tentando reconectar...');
    wsStatus.textContent = 'Desconectado';
    wsStatus.className = 'status-badge disconnected';
    setTimeout(connectWebSocket, reconnectInterval);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'init') {
        styleConfig = data.payload.styles;
        updateUIStyles(styleConfig);
        
        if (data.payload.activeSermonId) {
          loadSermonById(data.payload.activeSermonId, () => {
            if (data.payload.currentParagraphIndex !== -1) {
              selectParagraphLocal(data.payload.currentParagraphIndex, data.payload.isCleared);
            }
          });
        }
      } else if (data.type === 'sync-paragraph-selection') {
        selectParagraphLocal(data.payload.index, false);
      } else if (data.type === 'update-content') {
        if (data.payload.activeSermonId && (!currentSermon || currentSermon.id !== data.payload.activeSermonId)) {
          loadSermonById(data.payload.activeSermonId, () => {
            if (data.payload.currentParagraphIndex !== -1) {
              selectParagraphLocal(data.payload.currentParagraphIndex, data.payload.isCleared);
            }
          });
        } else {
          if (data.payload.currentParagraphIndex !== -1) {
            selectParagraphLocal(data.payload.currentParagraphIndex, data.payload.isCleared);
          } else {
            isCleared = data.payload.isCleared;
            updateMonitor();
          }
        }
      }
    } catch (err) {
      console.error('Erro ao ler mensagem WebSocket:', err);
    }
  };
}

// Fetch sermons from server API
async function fetchSermons() {
  try {
    const res = await fetch('/api/sermons');
    sermonsList = await res.json();
    
    sermonSelect.innerHTML = '<option value="">-- Selecione uma mensagem --</option>';
    sermonsList.forEach(sermon => {
      const option = document.createElement('option');
      option.value = sermon.id;
      option.textContent = `${sermon.id} - ${sermon.title} (${sermon.date})`;
      sermonSelect.appendChild(option);
    });

    if (currentSermon) {
      sermonSelect.value = currentSermon.id;
    }
  } catch (err) {
    console.error('Erro ao buscar biblioteca:', err);
    sermonSelect.innerHTML = '<option value="">Erro ao carregar mensagens</option>';
  }
}

// Load specific sermon
async function loadSermonById(id, callback) {
  if (!id) {
    unloadSermon();
    return;
  }
  
  try {
    const res = await fetch(`/api/sermons/${id}`);
    currentSermon = await res.json();
    currentParagraphs = currentSermon.paragraphs || [];
    
    // Atualiza metadados
    detailsTitle.textContent = currentSermon.title;
    detailsDate.textContent = currentSermon.date;
    detailsCount.textContent = currentParagraphs.length;
    activeSermonDetails.style.display = 'block';
    
    // Habilita controles
    paragraphSearch.removeAttribute('disabled');
    paragraphSearch.value = '';
    btnPrev.removeAttribute('disabled');
    btnNext.removeAttribute('disabled');
    btnClear.removeAttribute('disabled');
    
    // Renderiza lista
    renderParagraphsList();
    
    // Notifica servidor
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'set-sermon',
        payload: {
          id: currentSermon.id,
          title: currentSermon.title,
          date: currentSermon.date
        }
      }));
    }

    if (callback) callback();
  } catch (err) {
    console.error('Erro ao carregar sermão:', err);
    alert('Erro ao carregar os dados desta mensagem.');
  }
}

function unloadSermon() {
  currentSermon = null;
  currentParagraphs = [];
  activeParagraphIndex = -1;
  isCleared = true;
  
  activeSermonDetails.style.display = 'none';
  paragraphSearch.setAttribute('disabled', 'true');
  paragraphSearch.value = '';
  btnPrev.setAttribute('disabled', 'true');
  btnNext.setAttribute('disabled', 'true');
  btnClear.setAttribute('disabled', 'true');
  
  paragraphsList.innerHTML = '<div class="list-placeholder">Nenhuma mensagem carregada. Selecione uma na barra lateral.</div>';
  updateMonitor();
}

// Render paragraphs in column 2
function renderParagraphsList() {
  if (currentParagraphs.length === 0) {
    paragraphsList.innerHTML = '<div class="list-placeholder">Esta mensagem não possui parágrafos válidos.</div>';
    return;
  }

  paragraphsList.innerHTML = '';
  
  // Filtra parágrafos pela busca
  const query = currentSearchQuery.toLowerCase().trim();
  const filtered = currentParagraphs.filter(p => {
    if (!query) return true;
    return p.number.toString().includes(query) || p.text.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    paragraphsList.innerHTML = '<div class="list-placeholder">Nenhum parágrafo corresponde à busca.</div>';
    return;
  }

  filtered.forEach(p => {
    // Acha o índice real no array original
    const realIndex = currentParagraphs.findIndex(orig => orig.number === p.number);
    
    const row = document.createElement('div');
    row.className = `p-row ${realIndex === activeParagraphIndex ? 'active' : ''}`;
    row.id = `p-row-${realIndex}`;
    row.onclick = () => selectParagraph(realIndex);
    
    const num = document.createElement('div');
    num.className = 'p-num';
    num.textContent = p.number;
    
    const text = document.createElement('div');
    text.className = 'p-text';
    text.textContent = p.text;
    
    row.appendChild(num);
    row.appendChild(text);
    paragraphsList.appendChild(row);
  });

  // Mantém scroll no ativo se renderizar novamente
  if (activeParagraphIndex !== -1) {
    scrollToActiveParagraph();
  }
}

// Select a paragraph and broadcast
function selectParagraph(index) {
  if (index < 0 || index >= currentParagraphs.length) return;
  
  activeParagraphIndex = index;
  isCleared = false;
  
  // Atualiza visual local
  document.querySelectorAll('.p-row').forEach(row => row.classList.remove('active'));
  const activeRow = document.getElementById(`p-row-${index}`);
  if (activeRow) {
    activeRow.classList.add('active');
  }
  
  scrollToActiveParagraph();
  updateMonitor();

  // Envia por WebSocket
  const p = currentParagraphs[index];
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'set-paragraph',
      payload: {
        index: index,
        number: p.number,
        text: p.text
      }
    }));
  }
}

// Selection triggered by external event (WebSocket sync)
function selectParagraphLocal(index, serverIsCleared) {
  activeParagraphIndex = index;
  isCleared = serverIsCleared;
  
  document.querySelectorAll('.p-row').forEach(row => row.classList.remove('active'));
  const activeRow = document.getElementById(`p-row-${index}`);
  if (activeRow) {
    activeRow.classList.add('active');
  }
  
  scrollToActiveParagraph();
  updateMonitor();
}

function scrollToActiveParagraph() {
  const activeRow = document.getElementById(`p-row-${activeParagraphIndex}`);
  if (activeRow) {
    activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Clear screen toggling
function toggleClear() {
  if (activeParagraphIndex === -1) return;
  
  isCleared = !isCleared;
  updateMonitor();

  if (ws && ws.readyState === WebSocket.OPEN) {
    if (isCleared) {
      ws.send(JSON.stringify({ type: 'clear-screen' }));
    } else {
      // Re-envia o parágrafo atual para exibir
      const p = currentParagraphs[activeParagraphIndex];
      ws.send(JSON.stringify({
        type: 'set-paragraph',
        payload: {
          index: activeParagraphIndex,
          number: p.number,
          text: p.text
        }
      }));
    }
  }
}

// Update monitor box in admin screen
function updateMonitor() {
  if (isCleared || activeParagraphIndex === -1) {
    monitorOverlayBox.classList.add('cleared');
    monitorClearedBadge.textContent = 'Tela Limpa';
    monitorClearedBadge.className = 'badge badge-clear';
    monitorText.textContent = '(Texto ocultado)';
  } else {
    monitorOverlayBox.classList.remove('cleared');
    monitorClearedBadge.textContent = 'Transmitindo';
    monitorClearedBadge.className = 'badge badge-live';
    const p = currentParagraphs[activeParagraphIndex];
    
    if (currentSermon && styleConfig.showTitle) {
      monitorTitle.style.display = 'block';
      monitorTitle.textContent = `${currentSermon.title} - Parágrafo ${p.number}`;
    } else {
      monitorTitle.style.display = 'none';
    }
    monitorText.textContent = p.text;
  }
}

// Keyboard navigation
window.addEventListener('keydown', (e) => {
  // Ignora se estiver digitando em inputs ou textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    if (e.key === 'Escape') {
      e.target.blur();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ': // Espaço
      e.preventDefault();
      if (activeParagraphIndex < currentParagraphs.length - 1) {
        selectParagraph(activeParagraphIndex + 1);
      }
      break;
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault();
      if (activeParagraphIndex > 0) {
        selectParagraph(activeParagraphIndex - 1);
      }
      break;
    case 'Escape':
    case '.':
    case 'b':
    case 'B':
      e.preventDefault();
      toggleClear();
      break;
    case 'Enter':
      e.preventDefault();
      paragraphSearch.focus();
      break;
  }
});

// Event Listeners for UI controls
sermonSelect.onchange = (e) => {
  loadSermonById(e.target.value);
};

btnNext.onclick = () => {
  if (activeParagraphIndex < currentParagraphs.length - 1) {
    selectParagraph(activeParagraphIndex + 1);
  }
};

btnPrev.onclick = () => {
  if (activeParagraphIndex > 0) {
    selectParagraph(activeParagraphIndex - 1);
  }
};

btnClear.onclick = () => {
  toggleClear();
};

paragraphSearch.oninput = (e) => {
  currentSearchQuery = e.target.value;
  renderParagraphsList();
  
  // Se for apenas número, tenta marcar o parágrafo no topo
  const num = parseInt(currentSearchQuery, 10);
  if (!isNaN(num)) {
    const idx = currentParagraphs.findIndex(p => p.number === num);
    if (idx !== -1) {
      // Deixa focado visualmente, mas não seleciona até apertar enter ou clicar
      const row = document.getElementById(`p-row-${idx}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
};

// Se apertar Enter na barra de pesquisa e houver um parágrafo idêntico, seleciona-o
paragraphSearch.onkeydown = (e) => {
  if (e.key === 'Enter') {
    const num = parseInt(paragraphSearch.value.trim(), 10);
    if (!isNaN(num)) {
      const idx = currentParagraphs.findIndex(p => p.number === num);
      if (idx !== -1) {
        selectParagraph(idx);
        paragraphSearch.value = '';
        currentSearchQuery = '';
        renderParagraphsList();
        paragraphSearch.blur();
      }
    }
  }
};

// Styling settings modification and broadcasting
function gatherAndSendStyles() {
  const hexBg = styleBgColorPicker.value;
  const opacityPercent = parseInt(styleBgOpacity.value, 10);
  const opacityHex = Math.round(opacityPercent * 2.55).toString(16).padStart(2, '0');
  const bgRgba = hexToRgbaStr(hexBg, opacityPercent / 100);

  // Exibe valores hex e porcentagens nos labels
  document.querySelector('#style-bg-color-picker + .color-hex').textContent = hexBg;
  document.querySelector('#style-text-color + .color-hex').textContent = styleTextColor.value;
  document.querySelector('#style-accent-color + .color-hex').textContent = styleAccentColor.value;
  document.querySelector('#style-outline-color + .color-hex').textContent = styleOutlineColor.value;
  opacityVal.textContent = `${opacityPercent}%`;

  const fontSizeVal = `${styleSizeSlider.value}rem`;
  sizeSliderVal.textContent = fontSizeVal;

  const titleSizeVal = `${styleTitleSizeSlider.value}rem`;
  titleSizeSliderVal.textContent = titleSizeVal;

  const updatedStyles = {
    fontFamily: styleFont.value,
    fontSize: fontSizeVal,
    titleSize: titleSizeVal,
    textColor: styleTextColor.value,
    accentColor: styleAccentColor.value,
    bgColor: bgRgba,
    animationType: styleAnimation.value,
    showTitle: styleShowTitle.checked,
    telaoMode: styleTelaoMode.checked,
    textOutline: styleTextOutline.checked,
    outlineColor: styleOutlineColor.value
  };

  styleConfig = { ...styleConfig, ...updatedStyles };
  
  // Atualiza preview do monitor local
  applyStyleToMonitor();

  // Envia por WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'update-styles',
      payload: updatedStyles
    }));
  }
}

// Convert HEX string to RGBA string
function hexToRgbaStr(hex, alpha) {
  let r = 0, g = 0, b = 0;
  if (hex.length == 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length == 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Parse RGBA string to extract HEX and Opacity
function parseRgba(rgbaStr) {
  const match = rgbaStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return { hex: '#0a0f1e', opacity: 85 };
  
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  const opacity = match[4] ? Math.round(parseFloat(match[4]) * 100) : 100;
  
  const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return { hex, opacity };
}

// Apply styling local updates to UI inputs
function updateUIStyles(styles) {
  if (!styles) return;

  styleFont.value = styles.fontFamily || 'Outfit, sans-serif';
  const sizeNum = parseFloat(styles.fontSize || '2.6rem');
  styleSizeSlider.value = isNaN(sizeNum) ? 2.6 : sizeNum;
  sizeSliderVal.textContent = `${styleSizeSlider.value}rem`;
  const titleSizeNum = parseFloat(styles.titleSize || '1.1rem');
  styleTitleSizeSlider.value = isNaN(titleSizeNum) ? 1.1 : titleSizeNum;
  titleSizeSliderVal.textContent = `${styleTitleSizeSlider.value}rem`;
  styleAnimation.value = styles.animationType || 'slide-up';
  styleTextColor.value = styles.textColor || '#ffffff';
  styleAccentColor.value = styles.accentColor || '#2563eb';
  styleOutlineColor.value = styles.outlineColor || '#000000';
  document.querySelector('#style-outline-color + .color-hex').textContent = styleOutlineColor.value;
  
  if (styles.bgColor) {
    const { hex, opacity } = parseRgba(styles.bgColor);
    styleBgColorPicker.value = hex;
    styleBgOpacity.value = opacity;
    opacityVal.textContent = `${opacity}%`;
  }
  
  styleShowTitle.checked = styles.showTitle !== false;
  styleTelaoMode.checked = styles.telaoMode === true;
  styleTextOutline.checked = styles.textOutline === true;
  
  applyStyleToMonitor();
}

// Apply styles directly to the monitor element
function applyStyleToMonitor() {
  if (!styleConfig) return;
  
  monitorOverlayBox.style.fontFamily = styleConfig.fontFamily;
  monitorOverlayBox.style.color = styleConfig.textColor;
  monitorOverlayBox.style.borderColor = styleConfig.accentColor;
  
  if (styleConfig.telaoMode) {
    monitorOverlayBox.style.background = '#000000';
    monitorOverlayBox.style.borderLeft = 'none';
    monitorOverlayBox.style.borderRadius = '0';
    monitorOverlayBox.style.width = '100%';
    monitorOverlayBox.style.height = '100%';
    monitorOverlayBox.style.display = 'flex';
    monitorOverlayBox.style.flexDirection = 'column';
    monitorOverlayBox.style.justifyContent = 'center';
  } else {
    monitorOverlayBox.style.background = styleConfig.bgColor;
    monitorOverlayBox.style.borderLeft = `3px solid ${styleConfig.accentColor}`;
    monitorOverlayBox.style.borderRadius = '8px';
    monitorOverlayBox.style.width = '100%';
    monitorOverlayBox.style.height = 'auto';
    monitorOverlayBox.style.display = 'block';
  }
  
  const previewScale = 0.38;
  const pSize = parseFloat(styleConfig.fontSize || '2.6rem') * previewScale;
  const tSize = parseFloat(styleConfig.titleSize || '1.1rem') * previewScale;
  
  monitorText.style.fontSize = `${pSize}rem`;
  monitorTitle.style.fontSize = `${tSize}rem`;
  monitorTitle.style.color = styleConfig.accentColor;
  
  if (styleConfig.textOutline) {
    const oColor = styleConfig.outlineColor || '#000000';
    monitorText.style.textShadow = `-1px -1px 0 ${oColor}, 1px -1px 0 ${oColor}, -1px 1px 0 ${oColor}, 1px 1px 0 ${oColor}, 0px 2px 4px rgba(0,0,0,0.5)`;
    monitorTitle.style.textShadow = `-1px -1px 0 ${oColor}, 1px -1px 0 ${oColor}, -1px 1px 0 ${oColor}, 1px 1px 0 ${oColor}, 0px 2px 4px rgba(0,0,0,0.5)`;
  } else {
    monitorText.style.textShadow = 'none';
    monitorTitle.style.textShadow = 'none';
  }
  
  updateMonitor();
}

// Bind style inputs
[styleFont, styleSizeSlider, styleTitleSizeSlider, styleAnimation, styleTextColor, styleAccentColor, styleBgColorPicker, styleBgOpacity, styleShowTitle, styleTelaoMode, styleTextOutline, styleOutlineColor].forEach(input => {
  input.onchange = gatherAndSendStyles;
  input.oninput = gatherAndSendStyles;
});

btnResetStyles.onclick = () => {
  const defaultStyles = {
    fontFamily: 'Outfit, sans-serif',
    fontSize: '2.6rem',
    titleSize: '1.1rem',
    textColor: '#ffffff',
    accentColor: '#2563eb',
    bgColor: 'rgba(10, 15, 30, 0.85)',
    animationType: 'slide-up',
    showTitle: true,
    telaoMode: false,
    textOutline: false,
    outlineColor: '#000000'
  };
  styleConfig = { ...styleConfig, ...defaultStyles };
  updateUIStyles(styleConfig);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'update-styles',
      payload: defaultStyles
    }));
  }
};

// Modal controls
btnOpenImport.onclick = () => {
  importModal.style.display = 'flex';
  document.getElementById('import-date').focus();
};

function closeModal() {
  importModal.style.display = 'none';
  importForm.reset();
}

btnCloseImport.onclick = closeModal;
btnCancelImport.onclick = closeModal;

// Import form submission
importForm.onsubmit = async (e) => {
  e.preventDefault();
  
  const date = document.getElementById('import-date').value.trim();
  const title = document.getElementById('import-title').value.trim();
  const rawText = document.getElementById('import-text').value;

  // Gera o ID automaticamente a partir do título para simplificar o formulário
  const id = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s-]/g, "") // remove caracteres especiais
    .trim()
    .replace(/\s+/g, "_");

  try {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, date, title, rawText })
    });

    const result = await res.json();
    if (result.success) {
      alert(`Mensagem importada com sucesso! ${result.paragraphCount} parágrafos processados.`);
      closeModal();
      
      // Recarrega biblioteca de sermões
      await fetchSermons();
      
      // Carrega imediatamente o sermão importado
      sermonSelect.value = id;
      loadSermonById(id);
    } else {
      alert(`Erro na importação: ${result.error}`);
    }
  } catch (err) {
    console.error(err);
    alert('Erro de comunicação com o servidor ao importar.');
  }
};

// Copy link button handler
const btnCopyLink = document.getElementById('btn-copy-link');
const copyBtnText = document.getElementById('copy-btn-text');
if (btnCopyLink && copyBtnText) {
  btnCopyLink.onclick = () => {
    const linkUrl = `http://localhost:3000/overlay.html`;
    navigator.clipboard.writeText(linkUrl).then(() => {
      const originalText = copyBtnText.textContent;
      copyBtnText.textContent = 'Link Copiado!';
      btnCopyLink.style.background = 'rgba(16, 185, 129, 0.2)'; // tint verde
      
      setTimeout(() => {
        copyBtnText.textContent = originalText;
        btnCopyLink.style.background = '';
      }, 2000);
    }).catch(err => {
      console.error('Falha ao copiar link:', err);
    });
  };
}

// Autoupdater logic
async function checkUpdates() {
  try {
    const res = await fetch('/api/check-update');
    const data = await res.json();
    
    if (data.updateAvailable) {
      const banner = document.getElementById('update-banner');
      const versionText = document.getElementById('update-version-text');
      const btnStartUpdate = document.getElementById('btn-start-update');
      
      if (banner && versionText && btnStartUpdate) {
        versionText.textContent = `v${data.onlineVersion}`;
        banner.style.display = 'flex';
        
        btnStartUpdate.onclick = async () => {
          if (!confirm(`Deseja atualizar para a versão ${data.onlineVersion} de forma totalmente automática? O programa fechará e reabrirá.`)) {
            return;
          }
          
          // Exibe tela de carregamento de atualização
          const progressOverlay = document.getElementById('update-progress-overlay');
          if (progressOverlay) progressOverlay.style.display = 'flex';
          
          try {
            const updateRes = await fetch('/api/trigger-update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: data.url })
            });
            
            if (!updateRes.ok) {
              const errData = await updateRes.json();
              throw new Error(errData.error || 'Erro desconhecido');
            }
            
            console.log('Atualização iniciada com sucesso. Aguardando reinício...');
          } catch (err) {
            if (progressOverlay) progressOverlay.style.display = 'none';
            alert(`Falha ao instalar atualização: ${err.message}`);
          }
        };
      }
    }
  } catch (err) {
    console.error('Erro ao verificar atualizações:', err);
  }
}

// Initialize app
connectWebSocket();
fetchSermons();
unloadSermon();
checkUpdates();
