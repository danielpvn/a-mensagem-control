// Seletor de imagem de fundo (usado na aparência da Bíblia e dos Hinos).
// A lista é compartilhada: enviar ou apagar uma imagem atualiza todos os seletores.
import { toast, confirmDialog } from './ui.js';

let images = [];
const pickers = [];

export async function refreshBackgrounds() {
  try {
    images = await (await fetch('/api/backgrounds')).json();
  } catch (err) {
    images = [];
  }
  pickers.forEach(p => p.render());
  return images;
}

export const backgroundExists = (url) => images.some(img => img.url === url);

async function upload(file) {
  const res = await fetch(`/api/backgrounds?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: file
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

// container: onde desenhar; getValue(): url atual; onSelect(url | null)
export function createBackgroundPicker(container, { getValue, onSelect }) {
  const picker = {
    render() {
      const current = getValue();
      container.innerHTML = '';

      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'bg-tile bg-none';
      none.classList.toggle('active', !current);
      none.title = 'Sem imagem (só a cor de fundo)';
      none.textContent = 'Nenhuma';
      none.onclick = () => onSelect(null);
      container.appendChild(none);

      images.forEach(img => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'bg-tile';
        tile.classList.toggle('active', current === img.url);
        tile.title = img.name;
        tile.style.backgroundImage = `url("${img.url}")`;
        tile.onclick = () => onSelect(img.url);

        const remove = document.createElement('span');
        remove.className = 'bg-remove';
        remove.textContent = '×';
        remove.title = 'Apagar esta imagem';
        remove.onclick = async (e) => {
          e.stopPropagation();
          const ok = await confirmDialog({ title: 'Apagar imagem?', text: `"${img.name}" será removida dos fundos.`, okLabel: 'Apagar', danger: true });
          if (!ok) return;
          await fetch(`/api/backgrounds/${encodeURIComponent(img.name)}`, { method: 'DELETE' });
          if (getValue() === img.url) onSelect(null);
          refreshBackgrounds();
        };
        tile.appendChild(remove);
        container.appendChild(tile);
      });

      const add = document.createElement('label');
      add.className = 'bg-tile bg-add';
      add.title = 'Adicionar imagem (.jpg ou .png, de preferência 1920x1080)';
      add.innerHTML = '<span>+ Imagem</span>';
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          const saved = await upload(file);
          await refreshBackgrounds();
          onSelect(saved.url);
          toast('Imagem adicionada.', 'success');
        } catch (err) {
          toast(`Não foi possível enviar: ${err.message}`, 'error');
        }
      };
      add.appendChild(input);
      container.appendChild(add);
    }
  };
  pickers.push(picker);
  picker.render();
  return picker;
}
