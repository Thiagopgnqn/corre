with open('src/components/professors/StarRating.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Make interactive star buttons >= 44x44px touch target
content = content.replace(
    'className="p-0.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer transition-colors"',
    'className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer transition-colors"'
)

# Clear button touch target >= 44px
content = content.replace(
    'className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"',
    'className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"'
)

with open('src/components/professors/StarRating.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("StarRating patched successfully")

with open('src/components/professors/ReviewFormModal.tsx', 'r', encoding='utf-8') as f:
    r_content = f.read()

# Make ReviewFormModal bottom sheet friendly on mobile
r_content = r_content.replace(
    'className="fixed inset-0 z-[var(--z-modal-elevated)] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md"',
    'className="fixed inset-0 z-[var(--z-modal-elevated)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md overflow-hidden"'
)

r_content = r_content.replace(
    'className="w-full max-w-2xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"',
    'className="w-full max-w-2xl max-h-[92dvh] sm:max-h-[92vh] bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"'
)

# Inputs font size >= 16px to prevent iOS zoom
r_content = r_content.replace(
    'className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"',
    'className="w-full pl-8 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-base sm:text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"'
)

r_content = r_content.replace(
    'className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"',
    'className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 min-h-[44px] text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500"'
)

r_content = r_content.replace(
    'className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"',
    'className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-base sm:text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"'
)

# Footer sticky inside form
r_content = r_content.replace(
    'className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800"',
    'className="sticky bottom-0 bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-2 p-3 sm:p-4 -mx-4 -mb-4 sm:-mx-5 sm:-mb-5 border-t border-slate-800 shadow-lg"'
)

# Cancel and Submit button min-h-[44px]
r_content = r_content.replace(
    'className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"',
    'className="px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-slate-400 hover:text-white cursor-pointer flex items-center justify-center"'
)

r_content = r_content.replace(
    'className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"',
    'className="px-4 py-2.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"'
)

# Close modal button in header
r_content = r_content.replace(
    'className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"',
    'className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"'
)

with open('src/components/professors/ReviewFormModal.tsx', 'w', encoding='utf-8') as f:
    f.write(r_content)
print("ReviewFormModal patched successfully")

