# Patch SubjectLibraryView.tsx
with open('src/components/library/SubjectLibraryView.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Filter tabs min-h-[44px]
content = content.replace(
    'className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${',
    'className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center justify-center ${'
)

# Search input font size >= 16px to prevent iOS zoom
content = content.replace(
    'className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs"',
    'className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-base sm:text-xs"'
)

# Sort select min-h-[44px]
content = content.replace(
    'className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none"',
    'className="px-3 py-2 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none"'
)

# Download and helpful buttons min-h-[44px]
content = content.replace(
    'className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${',
    'className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold transition-all cursor-pointer border ${'
)

content = content.replace(
    'className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer"',
    'className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer"'
)

# Report button touch target
content = content.replace(
    'className="text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"',
    'className="text-slate-500 hover:text-slate-300 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"'
)

# Report modal z-index: migrate z-50 to z-[var(--z-modal)] and make bottom sheet friendly
content = content.replace(
    'className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"',
    'className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm"'
)

content = content.replace(
    'className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4"',
    'className="w-full max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl space-y-4"'
)

content = content.replace(
    'className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"',
    'className="w-full px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white"'
)

content = content.replace(
    'className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white resize-none"',
    'className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white resize-none"'
)

with open('src/components/library/SubjectLibraryView.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("SubjectLibraryView patched successfully")

# Patch MyUploadsView.tsx
with open('src/components/library/MyUploadsView.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Action buttons in cards: min-h-[44px] min-w-[44px]
content = content.replace(
    'className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"',
    'className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"'
)

content = content.replace(
    'className="p-2 rounded-xl bg-rose-950/30 hover:bg-rose-950/60 text-rose-400 hover:text-rose-300 border border-rose-500/25 transition-colors cursor-pointer"',
    'className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-rose-950/30 hover:bg-rose-950/60 text-rose-400 hover:text-rose-300 border border-rose-500/25 transition-colors cursor-pointer"'
)

# Edit & Delete modals: migrate z-50 to z-[var(--z-modal)] and make bottom sheet friendly
content = content.replace(
    'className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"',
    'className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm"'
)

content = content.replace(
    'className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4"',
    'className="w-full max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl space-y-4"'
)

content = content.replace(
    'className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"',
    'className="w-full px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white"'
)

content = content.replace(
    'className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white resize-none"',
    'className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white resize-none"'
)

# Modal action buttons min-h-[44px]
content = content.replace(
    'className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl"',
    'className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl flex items-center justify-center"'
)

content = content.replace(
    'className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold"',
    'className="px-5 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center"'
)

content = content.replace(
    'className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold"',
    'className="px-5 py-2.5 min-h-[44px] bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center justify-center"'
)

with open('src/components/library/MyUploadsView.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("MyUploadsView patched successfully")

# Patch LibraryHome.tsx
with open('src/components/library/LibraryHome.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Filter tabs min-h-[44px]
content = content.replace(
    'className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${',
    'className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center justify-center ${'
)

# Search input font-size >= 16px to prevent iOS zoom
content = content.replace(
    'className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"',
    'className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-base sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"'
)

with open('src/components/library/LibraryHome.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("LibraryHome patched successfully")

