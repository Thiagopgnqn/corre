with open('src/components/enrollments/EnrollmentModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Make modal bottom-sheet friendly on mobile
content = content.replace(
    'className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md"',
    'className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md overflow-hidden"'
)

content = content.replace(
    'className="w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"',
    'className="w-full max-w-2xl max-h-[90dvh] sm:max-h-[90vh] bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"'
)

# Close button min-h-[44px] min-w-[44px]
content = content.replace(
    'className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"',
    'className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"'
)

# Status buttons min-h-[44px]
content = content.replace(
    'className={`px-2 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center ${',
    'className={`px-2.5 py-2 min-h-[44px] rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center flex items-center justify-center ${'
)

# Mode selector buttons min-h-[44px]
content = content.replace(
    'className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${',
    'className={`p-3 min-h-[44px] rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex flex-col justify-center ${'
)

content = content.replace(
    'className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${',
    'className={`p-3 min-h-[44px] rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-center ${'
)

# Search input font size >= 16px to prevent iOS zoom
content = content.replace(
    'className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"',
    'className="w-full pl-8 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-base sm:text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"'
)

# Footer buttons min-h-[44px]
content = content.replace(
    'className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"',
    'className="px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-center"'
)

content = content.replace(
    'className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-45 text-white text-xs font-extrabold shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"',
    'className="px-5 py-2.5 min-h-[44px] rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-45 text-white text-xs font-extrabold shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"'
)

with open('src/components/enrollments/EnrollmentModal.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("EnrollmentModal patched successfully")

