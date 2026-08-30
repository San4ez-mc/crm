export default function Modal({ isOpen, title, children, onClose, wide }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-xl border border-slate-800 bg-slate-900 shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
