// Доступність розмірів і кольорів товару — спільне для адмінки/бота (routes/products.js) і відкритого каталогу для сайту (routes/public-catalog.js).
// Product.sizes — майстер-список розмірів; Offer.availableSizes — звуження САМЕ для цього кольору (Offer.sizesCustomized=true).
// Порожній availableSizes при sizesCustomized=true — «у цьому кольорі розпродано все», а не «успадковує все».
function offerEffectiveSizes(product, offer) {
  return offer.sizesCustomized ? (Array.isArray(offer.availableSizes) ? offer.availableSizes : []) : (product.sizes || []);
}
function offerInStock(product, offer) {
  if (product.outOfStock) return false;
  if (product.alwaysAvailable !== false) return true;
  // Товар ще не має майстер-списку розмірів — нема на чому звужувати, лишаємо доступним.
  if (!Array.isArray(product.sizes) || product.sizes.length === 0) return true;
  return offerEffectiveSizes(product, offer).length > 0;
}
module.exports = { offerEffectiveSizes, offerInStock };
