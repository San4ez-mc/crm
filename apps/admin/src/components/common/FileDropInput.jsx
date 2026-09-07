// §9.3 — drag&drop або вибір файлу; для offers — галерея до 10 фото, перше = головне,
// порядок можна міняти (тут — кнопками ↑/↓, функціонально еквівалентно перетягуванню).
//
// ВИПРАВЛЕНО 2026-09-07 (реальний баг, знайдено при "фото не завантажуються" в Олексія):
// прихований <input id="single-file-input">/`multi-file-input-${max}`> мав ОДНАКОВИЙ id на
// ВСІХ інстансах цього компонента на сторінці (мініатюра + розмірна сітка на одному товарі;
// "Загальні фото" + фото КОЖНОГО варіанту — усі з max=10 за замовчуванням). Клік на будь-якому
// дроп-зоні, крім першої, робив document.getElementById(...) → браузер повертав ПЕРШИЙ елемент
// з таким id у DOM — файл летів у ЗОВСІМ ІНШЕ поле (перше на сторінці), а той бокс, куди
// клацнув користувач, виглядав так, ніби "нічого не відбулось". useId() дає кожному інстансу
// унікальний id — тепер клік завжди відкриває діалог саме для СВОГО прихованого інпута.
import { useId, useState } from 'react';
import { api } from '../../api/client';
import ImageLightbox from './ImageLightbox';

export function SingleFileDrop({ value, onChange }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);

  async function handleFiles(files) {
    const file = files[0];
    if (!file) return;
    setUploading(true); setError('');
    try { onChange(await api.uploadFile(file)); }
    catch (e) { setError(e.message); }
    finally { setUploading(false); }
  }

  return (
    <div>
      <div
        className="flex h-56 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/50 text-xs text-slate-500 hover:border-brand"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => document.getElementById(inputId)?.click()}
      >
        {value ? <img src={value} alt="" className="h-full w-full rounded-lg object-contain p-1" onClick={(e) => { e.stopPropagation(); setLightbox(value); }} /> : <span>{uploading ? 'Завантаження…' : 'Перетягніть файл або клікніть'}</span>}
      </div>
      <input id={inputId} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      {value && <button type="button" onClick={() => onChange('')} className="mt-1 text-xs text-slate-500 hover:text-red-400">Видалити</button>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

export function MultiImageDrop({ value = [], onChange, max = 10 }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);

  async function handleFiles(files) {
    const list = Array.from(files).slice(0, max - value.length);
    if (!list.length) return;
    setUploading(true); setError('');
    try {
      const urls = await Promise.all(list.map((f) => api.uploadFile(f)));
      onChange([...value, ...urls].slice(0, max));
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  }

  function move(i, dir) {
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(i + dir, 0, item);
    onChange(next);
  }

  return (
    <div>
      <div
        className="mb-2 flex h-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/50 text-xs text-slate-500 hover:border-brand"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => document.getElementById(inputId)?.click()}
      >
        {uploading ? 'Завантаження…' : `Перетягніть до ${max} фото або клікніть (перше = головне)`}
      </div>
      <input id={inputId} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div key={url} className="relative h-32 w-32 overflow-hidden rounded-lg border border-slate-700">
            <img src={url} alt="" className="h-full w-full cursor-zoom-in object-cover" onClick={() => setLightbox(url)} />
            {i === 0 && <span className="absolute left-0.5 top-0.5 rounded bg-brand px-1 text-[10px]">гол.</span>}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 px-0.5">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-[10px] text-white disabled:opacity-30">←</button>
              <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="text-[10px] text-red-400">✕</button>
              <button type="button" disabled={i === value.length - 1} onClick={() => move(i, 1)} className="text-[10px] text-white disabled:opacity-30">→</button>
            </div>
          </div>
        ))}
      </div>
      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
