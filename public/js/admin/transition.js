// Tempo da transição com "sem transição" no começo do controle (no lugar de uma opção a mais na lista de efeitos)
// e o "Onde usar a transição": tudo, só entrada e saída, ou só entre parágrafos/estrofes/versículos/mídias.

export function timeLabel(seconds, zeroText = 'Sem transição') {
  const value = Number(seconds);
  return value > 0 ? `${value.toFixed(1).replace('.', ',')} s` : zeroText;
}

// Estilos salvos antes desta versão: "Sem transição" era um efeito da lista
export function savedTime(styles, fallback = 0.4) {
  if (styles.animationType === 'none') return 0;
  return styles.transitionTime ?? fallback;
}

export function savedEffect(styles, fallback) {
  return styles.animationType && styles.animationType !== 'none' ? styles.animationType : fallback;
}

export function scopeRadios(name) {
  return [...document.querySelectorAll(`input[name="${name}"]`)];
}

export function checkedScope(radios) {
  return (radios.find(r => r.checked) || radios[0]).value;
}

export function setScope(radios, value) {
  radios.forEach(r => { r.checked = r.value === (value || 'all'); });
}
