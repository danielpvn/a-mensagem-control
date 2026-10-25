// Utilidades de interface: avisos (toasts), confirmação, abas e helpers.

export const $ = (id) => document.getElementById(id);

export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('leaving'), 3200);
  setTimeout(() => el.remove(), 3600);
}

// Confirmação no estilo do app (substitui o confirm() nativo)
export function confirmDialog({ title, text, okLabel = 'Confirmar', danger = false }) {
  const modal = $('confirm-modal');
  const ok = $('confirm-ok');
  const cancel = $('confirm-cancel');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text || '';
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  modal.hidden = false;
  ok.focus();

  return new Promise(resolve => {
    const close = (result) => {
      modal.hidden = true;
      ok.onclick = cancel.onclick = modal.onclick = document.onkeydown = null;
      resolve(result);
    };
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    modal.onclick = (e) => { if (e.target === modal) close(false); };
    document.onkeydown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
    };
  });
}

export function isModalOpen() {
  return [...document.querySelectorAll('.modal')].some(m => !m.hidden);
}

// Remove acentos e caixa para comparar textos ("Fé" encontra "fe")
export function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// "2026-10-17 22:31:04" (UTC do SQLite) -> "sexta, 17/10"
export function formatDay(sqliteDate) {
  if (!sqliteDate) return '';
  const date = new Date(sqliteDate.replace(' ', 'T') + 'Z');
  if (isNaN(date)) return '';
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '');
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${weekday}, ${day}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado!', 'success');
  } catch (err) {
    toast('Não foi possível copiar.', 'error');
  }
}

let activeTab = 'mensagem';
const tabListeners = [];

export const getActiveTab = () => activeTab;
export const onTabChange = (handler) => tabListeners.push(handler);

export function selectTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  try { localStorage.setItem('amc.tab', name); } catch (e) { /* sem armazenamento */ }
  tabListeners.forEach(handler => handler(name));
}

export function setupTabs() {
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => selectTab(t.dataset.tab));

  let saved = null;
  try { saved = localStorage.getItem('amc.tab'); } catch (e) { /* sem armazenamento */ }
  if (saved && document.querySelector(`.tab[data-tab="${saved}"]`)) selectTab(saved);
}

export function setupModalClose(modal, onClose) {
  modal.querySelectorAll('[data-close]').forEach(btn => btn.onclick = onClose);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) onClose(); });
}
