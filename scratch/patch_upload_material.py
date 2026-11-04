with open('src/components/library/UploadMaterialModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Update modal overlay & container
content = content.replace(
    'className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"',
    'className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"'
)

content = content.replace(
    'className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6"',
    'className="w-full max-w-xl max-h-[92dvh] sm:max-h-[92vh] bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col my-0 sm:my-6"'
)

# Header close button touch target
content = content.replace(
    'className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"',
    'className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"'
)

# Form container scrollable
content = content.replace(
    '<form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">',
    '<form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">'
)

# File input: accept="application/pdf,image/jpeg,image/png,image/webp" without capture
content = content.replace(
    'accept=".pdf,image/png,image/jpeg,image/webp"',
    'accept="application/pdf,image/jpeg,image/png,image/webp"'
)

# Dropzone inner content: add explicit "Elegir archivo o foto" button with min-h-[44px]
old_empty_dropzone = """                  <div className="space-y-1.5">
                    <UploadCloud className="w-8 h-8 text-indigo-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-200">
                      Arrastrá tu archivo acá o <span className="text-indigo-400 underline">buscalo en tu dispositivo</span>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Formatos soportados: PDF (hasta 25 MB), PNG, JPEG, WEBP (hasta 10 MB)
                    </p>
                  </div>"""

new_empty_dropzone = """                  <div className="space-y-2 py-1">
                    <UploadCloud className="w-8 h-8 text-indigo-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-200">
                      Arrastrá tu archivo acá o tocalo para buscarlo
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Formatos soportados: PDF (hasta 25 MB), PNG, JPEG, WEBP (hasta 10 MB)
                    </p>
                    <div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-300 font-bold text-xs border border-indigo-500/40 cursor-pointer shadow-sm transition-all"
                      >
                        <UploadCloud className="w-4 h-4" />
                        <span>Elegir archivo o foto</span>
                      </button>
                    </div>
                  </div>"""

content = content.replace(old_empty_dropzone, new_empty_dropzone)

# Inputs font-size >= 16px to prevent iOS zoom
content = content.replace(
    'className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"',
    'className="w-full px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500"'
)

content = content.replace(
    'className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"',
    'className="w-full px-2.5 py-2 min-h-[44px] rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs text-white"'
)

content = content.replace(
    'className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"',
    'className="w-full px-2.5 py-2 min-h-[44px] rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs text-white"'
)

content = content.replace(
    'className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none"',
    'className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500 resize-none"'
)

# Terms checkbox container touch target min-h-[44px]
content = content.replace(
    '<div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">',
    '<div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 min-h-[44px]">'
)

content = content.replace(
    '<label className="flex items-start gap-2.5 cursor-pointer">',
    '<label className="flex items-start gap-2.5 cursor-pointer min-h-[44px]">'
)

content = content.replace(
    'className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900 mt-0.5"',
    'className="w-5 h-5 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900 mt-0.5 shrink-0"'
)

# Sticky actions footer
content = content.replace(
    'className="flex items-center justify-end gap-3 pt-2"',
    'className="sticky bottom-0 bg-slate-900/95 backdrop-blur-md flex items-center justify-end gap-3 p-3 sm:p-4 -mx-4 -mb-4 sm:-mx-6 sm:-mb-6 border-t border-slate-800 shadow-lg"'
)

content = content.replace(
    'className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-40"',
    'className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center"'
)

content = content.replace(
    'className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"',
    'className="px-5 py-2.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"'
)

with open('src/components/library/UploadMaterialModal.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("UploadMaterialModal patched successfully")

