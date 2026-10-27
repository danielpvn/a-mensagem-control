// Arrastar para reordenar (lista do culto e mídias). Avisa só "de onde" e "para onde".
// axis: 'y' para listas (antes/depois pela altura), 'x' para grades (pela largura).
export function makeSortable(container, selector, onMove, { axis = 'y' } = {}) {
  let from = null;
  let marked = null;

  const items = () => [...container.querySelectorAll(selector)];
  const unmark = () => {
    if (marked) marked.classList.remove('drop-before', 'drop-after');
    marked = null;
  };
  // Depois da metade do item, o arrastado entra depois dele
  const isAfter = (item, e) => {
    const r = item.getBoundingClientRect();
    return axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  };

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest(selector);
    if (!item || !container.contains(item)) return;
    from = items().indexOf(item);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-amc-sort', String(from));
  });

  container.addEventListener('dragover', (e) => {
    if (from === null) return;
    e.preventDefault();
    e.stopPropagation();
    const item = e.target.closest(selector);
    if (!item) return;
    if (marked !== item) unmark();
    marked = item;
    const after = isAfter(item, e);
    item.classList.toggle('drop-after', after);
    item.classList.toggle('drop-before', !after);
  });

  container.addEventListener('drop', (e) => {
    if (from === null) return;
    e.preventDefault();
    e.stopPropagation();
    const item = e.target.closest(selector);
    if (item) {
      let to = items().indexOf(item) + (isAfter(item, e) ? 1 : 0);
      if (to > from) to--;
      if (to !== from) onMove(from, to);
    }
    unmark();
  });

  container.addEventListener('dragend', () => {
    items().forEach(i => i.classList.remove('dragging'));
    unmark();
    from = null;
  });
}

// Devolve uma cópia da lista com o item movido
export function moveItem(list, from, to) {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
