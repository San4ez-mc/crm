// Збільшення фото по кліку — використовується у FileDropInput (мініатюра, галереї, розмірна сітка).
export default function ImageLightbox({ url, onClose }) {
  if (!url) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button type="button" onClick={onClose} className="absolute right-6 top-6 text-2xl text-white/80 hover:text-white">✕</button>
    </div>
  );
}
