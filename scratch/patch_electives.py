with open('src/components/electives/ElectivesPicker.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add useIsMobile and BottomSheet import
if 'useIsMobile' not in content:
    content = content.replace(
        "import { useCareer } from '../../context/CareerContext';",
        "import { useCareer } from '../../context/CareerContext';\nimport { useIsMobile } from '../../hooks/useIsMobile';\nimport { BottomSheet } from '../common/BottomSheet';"
    )

# Add isMobile and selectedMobileYear state
if 'const isMobile = useIsMobile();' not in content:
    content = content.replace(
        "const [modalSearch, setModalSearch] = useState('');",
        "const [modalSearch, setModalSearch] = useState('');\n  const isMobile = useIsMobile();\n  const [selectedMobileYear, setSelectedMobileYear] = useState<number | 'all'>('all');"
    )

# Segmented year selector on mobile above years container
year_pills = """
      {/* Mobile Year Selector Chips */}
      {isMobile && (
        <div className="flex items-center gap-1.5 p-1.5 bg-slate-900/80 rounded-2xl border border-slate-800 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedMobileYear('all')}
            className={`px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold transition-all flex items-center justify-center shrink-0 ${
              selectedMobileYear === 'all'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Todos los años
          </button>
          {[1, 2, 3, 4, 5].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setSelectedMobileYear(y)}
              className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-bold transition-all flex items-center justify-center shrink-0 ${
                selectedMobileYear === y
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {y}° Año
            </button>
          ))}
        </div>
      )}
"""

content = content.replace(
    '      {/* Years Container: 1° to 5° */}\n      <div className="space-y-5">',
    year_pills + '\n      {/* Years Container: 1° to 5° */}\n      <div className="space-y-5">'
)

# Filter years in map based on mobile selection
content = content.replace(
    '{years.map((year) => {',
    '{years.filter((y) => (!isMobile || selectedMobileYear === \'all\' || selectedMobileYear === y)).map((year) => {'
)

# Draggable disabled on mobile
content = content.replace(
    'draggable\n                        onDragStart={(e) => handleDragStart(e, elective.id)}',
    'draggable={!isMobile}\n                        onDragStart={(e) => !isMobile && handleDragStart(e, elective.id)}'
)

# Touch targets: Agregar electiva button
content = content.replace(
    'className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1.5 shadow-sm"',
    'className="px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1.5 shadow-sm"'
)

# Touch targets: Cambiar estado
content = content.replace(
    'className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-amber-600 text-slate-200 hover:text-white transition-all flex items-center gap-1"',
    'className="px-3 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-slate-800 hover:bg-amber-600 text-slate-200 hover:text-white transition-all flex items-center gap-1"'
)

# Touch targets: Mover a otro año select
content = content.replace(
    'className="text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 rounded-lg px-1.5 py-1 focus:ring-1 focus:ring-amber-500"',
    'className="text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 rounded-xl px-2.5 py-2 min-h-[44px] focus:ring-1 focus:ring-amber-500"'
)

# Touch targets: Remove trash button
content = content.replace(
    'className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"',
    'className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"'
)

# Modal overlay: update z-50 to z-[var(--z-modal)]
content = content.replace(
    'className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"',
    'className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm"'
)

# Modal input font-size >= 16px to prevent iOS zoom
content = content.replace(
    'className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"',
    'className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-base sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"'
)

# Modal touch targets: Quitar and Agregar buttons
content = content.replace(
    'className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1.5"',
    'className="px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-500/30 transition-all flex items-center justify-center gap-1.5"'
)

# Modal Add button min-h-[44px]
content = content.replace(
    'className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${',
    'className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${'
)

# Modal close / listo button min-h-[44px]
content = content.replace(
    'className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors"',
    'className="px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors flex items-center justify-center"'
)

with open('src/components/electives/ElectivesPicker.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("ElectivesPicker patched successfully")

