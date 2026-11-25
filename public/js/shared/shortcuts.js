// Atalhos do teclado que o operador escolhe (Configurações > Atalhos de teclado).
// Usado pelo servidor (require), pelo painel (import) e pelo main.js do Electron (atalhos com o app minimizado).
// Cada ação tem uma lista de teclas; lista vazia = a ação fica sem atalho.
// Tecla = KeyboardEvent.key (letras em minúsculo), com "Ctrl+", "Alt+", "Shift+" na frente quando houver.

export const SHORTCUT_ACTIONS = [
  { id: 'next', label: 'Próximo', hint: 'Parágrafo, estrofe, versículo ou mídia seguinte', keys: ['ArrowRight', 'PageDown', ' '] },
  { id: 'prev', label: 'Anterior', hint: 'Volta um', keys: ['ArrowLeft', 'PageUp'] },
  { id: 'toggle', label: 'Exibir / Ocultar', hint: 'A mesma tecla põe no ar e tira da tela (alterna)', keys: ['Escape', '.', 'b'] },
  { id: 'show', label: 'Exibir', hint: 'Só põe no ar o que está pronto na aba aberta', keys: [] },
  { id: 'hide', label: 'Ocultar', hint: 'Só tira da tela o que está no ar na aba aberta', keys: [] },
  { id: 'clear', label: 'Limpar tela', hint: 'Tira tudo da tela, inclusive o nome do pregador', keys: [] },
  { id: 'lowerThird', label: 'Nome do pregador', hint: 'Mostra ou esconde, em qualquer aba', keys: ['n'] },
  { id: 'search', label: 'Ir para a busca', hint: 'Na aba aberta', keys: ['Enter'] },
  { id: 'globalNext', label: 'Passador: próximo', hint: 'Funciona com o app minimizado', keys: ['PageDown'], global: true },
  { id: 'globalPrev', label: 'Passador: anterior', hint: 'Funciona com o app minimizado', keys: ['PageUp'], global: true }
];

export const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_ACTIONS.map(a => [a.id, [...a.keys]]));

// Junta o que foi salvo com o padrão (ação nova ganha o padrão; ação salva vazia continua vazia)
export function cleanShortcuts(saved) {
  const out = {};
  SHORTCUT_ACTIONS.forEach(a => {
    const list = saved && Array.isArray(saved[a.id]) ? saved[a.id] : a.keys;
    out[a.id] = [...new Set(list.map(k => String(k)).filter(k => k && k.length <= 40))].slice(0, 6);
  });
  return out;
}

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'Dead', 'Unidentified', 'Process'];

// Tecla apertada -> texto guardado. null para teclas que sozinhas não servem (Ctrl, Shift...).
export function keyFromEvent(e) {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  let key = e.key;
  const printable = key.length === 1;
  if (printable) key = key.toLowerCase();
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  // Em letras e sinais o Shift já muda o próprio caractere; nas outras teclas ele conta
  if (e.shiftKey && !printable) mods.push('Shift');
  return [...mods, key].join('+');
}

const NAMES = {
  ' ': 'Espaço', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓',
  PageDown: 'Page Down', PageUp: 'Page Up', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', Tab: 'Tab'
};

// Texto para mostrar na tela ("Ctrl+→", "Espaço", "B")
export function keyLabel(key) {
  return String(key).split('+').map((part, i, parts) => {
    if (i < parts.length - 1) return part;
    if (part === '') return '+';
    if (NAMES[part]) return NAMES[part];
    return part.length === 1 ? part.toUpperCase() : part;
  }).join('+');
}

// Tecla guardada -> atalho do Electron (globalShortcut). null se não der para registrar.
const ACCELERATOR_KEYS = {
  ArrowRight: 'Right', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space',
  PageDown: 'PageDown', PageUp: 'PageUp', Escape: 'Esc', Enter: 'Return', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', '+': 'Plus',
  MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack'
};
export function toAccelerator(key) {
  const parts = String(key).split('+');
  const last = parts.pop() || '+';
  const mods = parts.map(m => ({ Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift' }[m])).filter(Boolean);
  let base = ACCELERATOR_KEYS[last];
  if (!base && /^F([1-9]|1[0-9]|2[0-4])$/.test(last)) base = last;
  if (!base && last.length === 1 && /[a-z0-9.,;'`\-=/\\[\]]/i.test(last)) base = last.toUpperCase();
  return base ? [...mods, base].join('+') : null;
}
