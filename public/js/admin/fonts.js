// Fontes que vêm dentro do app (public/fonts.css, funcionam sem internet). A mesma lista em todas
// as abas: cada <select data-font-select> é preenchido aqui, mantendo o valor que já estava salvo.
export const FONTS = [
  ['Montserrat, sans-serif', 'Montserrat (larga e forte)'],
  ['Outfit, sans-serif', 'Outfit (moderna)'],
  ["'Poppins', sans-serif", 'Poppins (redonda)'],
  ["'Roboto', sans-serif", 'Roboto (simples)'],
  ["'Open Sans', sans-serif", 'Open Sans (bem legível)'],
  ["'Raleway', sans-serif", 'Raleway (fina e elegante)'],
  ["'Oswald', sans-serif", 'Oswald (estreita, para títulos)'],
  ["'Bebas Neue', sans-serif", 'Bebas Neue (só maiúsculas, impacto)'],
  ["'Lora', serif", 'Lora (elegante, com serifa)'],
  ["'Playfair Display', serif", 'Playfair Display (tradicional)'],
  ["'Crimson Pro', serif", 'Crimson Pro (bíblica, com serifa)'],
  ["'Merriweather', serif", 'Merriweather (clássica de livro)'],
  ["'Cinzel', serif", 'Cinzel (letras romanas)'],
  ["'Great Vibes', cursive", 'Great Vibes (manuscrita)'],
  ['Arial, sans-serif', 'Arial (do Windows)']
];

export function fillFontSelects() {
  document.querySelectorAll('select[data-font-select]').forEach(select => {
    const current = select.value;
    select.innerHTML = '';
    FONTS.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.style.fontFamily = value;
      select.appendChild(option);
    });
    select.value = current || FONTS[0][0];
  });
}
