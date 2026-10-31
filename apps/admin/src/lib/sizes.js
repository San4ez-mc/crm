// Розміри одягу: однакові розміри з різним написанням (2XL = XXL, 3XL = XXXL, кирилична «ХХЛ» = XXL) — один ключ порівняння.
// Каталог має змішані написання (A0182 — 2XL, A0068 — 3XL, j0032 — для одного кольору і 3XL, і XXXL), а бот записує в замовлення те,
// що написав клієнт. Порівнювати розміри в формах треба через цей ключ, а не рядками (Edits Олексія 31.10: «XXL та 2XL — це один
// і той самий розмір, чому пишеться "немає"»). Те саме правило, що в боті: shopAgent/catalogFacts.js sizeKey.
export function sizeKey(s) {
  return String(s || '').toUpperCase().trim()
    .replace(/Х/g, 'X').replace(/Л/g, 'L').replace(/М/g, 'M').replace(/С/g, 'S')
    .replace(/^2XL$/, 'XXL').replace(/^3XL$/, 'XXXL').replace(/^4XL$/, 'XXXXL');
}

/** Той самий розмір у списку (за ключем) або undefined. */
export function findSize(list, size) {
  if (!size) return undefined;
  const k = sizeKey(size);
  return (list || []).find((s) => sizeKey(s) === k);
}
