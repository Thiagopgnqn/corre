with open('src/components/stats/StatsDashboard.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add w-full overflow-hidden to main wrapper
content = content.replace(
    'className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6"',
    'className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 w-full overflow-hidden"'
)

# Tab navigation min-h-[44px]
content = content.replace(
    'className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-xl font-bold whitespace-nowrap shrink-0 transition-all ${',
    'className={`px-3.5 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm rounded-xl font-bold whitespace-nowrap shrink-0 transition-all flex items-center justify-center ${'
)

# Mode selector switch buttons min-h-[44px]
content = content.replace(
    'className={`px-2.5 py-1.5 rounded-lg text-center text-[11px] sm:text-xs transition-all ${',
    'className={`px-3 py-2 min-h-[44px] rounded-lg text-center text-xs transition-all flex items-center justify-center ${'
)

# Progress Rings: change grid-cols-1 md:grid-cols-2 lg:grid-cols-4 to grid-cols-2 lg:grid-cols-4
content = content.replace(
    'data-tour="stats-rings" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"',
    'data-tour="stats-rings" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4"'
)

# In progress rings, make padding and svg responsive so 2-col fits cleanly on 360px
content = content.replace(
    'className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col justify-between"',
    'className="p-3 sm:p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col justify-between"'
)

content = content.replace(
    '<svg className="w-16 h-16 transform -rotate-90 shrink-0">',
    '<svg className="w-12 h-12 sm:w-16 sm:h-16 transform -rotate-90 shrink-0">'
)

content = content.replace(
    'className="text-3xl font-black text-white"',
    'className="text-xl sm:text-3xl font-black text-white"'
)
content = content.replace(
    'className="text-3xl font-black text-cyan-400"',
    'className="text-xl sm:text-3xl font-black text-cyan-400"'
)
content = content.replace(
    'className="text-3xl font-black text-emerald-400"',
    'className="text-xl sm:text-3xl font-black text-emerald-400"'
)
content = content.replace(
    'className="text-3xl font-black text-indigo-400"',
    'className="text-xl sm:text-3xl font-black text-indigo-400"'
)

# Grades setting checkboxes touch target min-h-[44px]
content = content.replace(
    'className="flex items-center gap-2 text-slate-300 cursor-pointer"',
    'className="flex items-center gap-2 text-slate-300 cursor-pointer min-h-[44px]"'
)

content = content.replace(
    'className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs focus:outline-none"',
    'className="bg-slate-950 border border-slate-700 text-slate-200 rounded-xl px-2.5 py-2 min-h-[44px] text-xs focus:outline-none"'
)

# Grade Metrics: change grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 to grid-cols-2 lg:grid-cols-4
content = content.replace(
    'className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"',
    'className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4"'
)

content = content.replace(
    'className="text-4xl font-black text-indigo-400 my-2"',
    'className="text-2xl sm:text-4xl font-black text-indigo-400 my-2"'
)
content = content.replace(
    'className="text-4xl font-black text-rose-400 my-2"',
    'className="text-2xl sm:text-4xl font-black text-rose-400 my-2"'
)
content = content.replace(
    'className="text-4xl font-black text-emerald-400 my-2"',
    'className="text-2xl sm:text-4xl font-black text-emerald-400 my-2"'
)
content = content.replace(
    'className="text-4xl font-black text-amber-400 my-2"',
    'className="text-2xl sm:text-4xl font-black text-amber-400 my-2"'
)

# Padding in grade metric cards
content = content.replace(
    'className="p-5 rounded-2xl border border-indigo-500/30 bg-slate-900/60 backdrop-blur-md text-center"',
    'className="p-3 sm:p-5 rounded-2xl border border-indigo-500/30 bg-slate-900/60 backdrop-blur-md text-center"'
)
content = content.replace(
    'className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md text-center"',
    'className="p-3 sm:p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md text-center"'
)

with open('src/components/stats/StatsDashboard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("StatsDashboard patched successfully")

