import re

with open('src/components/planner/SemesterPlanner.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add useIsMobile and BottomSheet imports
if 'useIsMobile' not in content:
    content = content.replace(
        "import { useCareer } from '../../context/CareerContext';",
        "import { useCareer } from '../../context/CareerContext';\nimport { useIsMobile } from '../../hooks/useIsMobile';\nimport { BottomSheet } from '../common/BottomSheet';"
    )

# Add isMobile state
if 'const isMobile = useIsMobile();' not in content:
    content = content.replace(
        "const [includeElectives, setIncludeElectives] = useState<boolean>(true);",
        "const [includeElectives, setIncludeElectives] = useState<boolean>(true);\n  const isMobile = useIsMobile();\n  const [isMobileBasketOpen, setIsMobileBasketOpen] = useState(false);"
    )

# Ensure buttons have min-h-[44px] and touch-friendly padding
content = content.replace(
    'className={`px-2.5 sm:px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-all',
    'className={`px-3 py-2 min-h-[44px] rounded-xl font-semibold shrink-0 transition-all flex items-center justify-center'
)

# Touch target for include electives
content = content.replace(
    'className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800"',
    'className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer bg-slate-900 px-3.5 py-2 min-h-[44px] rounded-xl border border-slate-800"'
)

# Touch target for Sumar button
content = content.replace(
    'className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 shrink-0 ${',
    'className={`px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 shrink-0 ${'
)

# Main container padding
content = content.replace(
    'className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6"',
    'className={`max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 ${isMobile ? \'pb-[calc(var(--mobile-nav-height,4rem)+5rem+env(safe-area-inset-bottom,0px))]\' : \'\'}`}'
)

# Hide desktop basket column on mobile
content = content.replace(
    '{/* Selected Basket Summary (1 Col) */}\n        <div className="space-y-4 sticky top-20">',
    '{/* Selected Basket Summary (1 Col) */}\n        <div className="space-y-4 sticky top-20 hidden lg:block">'
)

# Add floating bar and bottom sheet before the closing </div> of return
floating_bar_code = """
      {/* Mobile Floating Bar */}
      {isMobile && (
        <div
          data-testid="planner-floating-bar"
          className="fixed left-0 right-0 p-3 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 shadow-2xl flex items-center justify-between gap-3"
          style={{
            bottom: 'calc(var(--mobile-nav-height, 4rem) + env(safe-area-inset-bottom, 0px))',
            zIndex: 'var(--z-planner-bar)',
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-bold text-white truncate">
                {basketSubjects.length} {basketSubjects.length === 1 ? 'materia' : 'materias'}
              </span>
              <span className="text-cyan-300 font-extrabold shrink-0">· {totalWeeklyHours} hs</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {basketSubjects.length === 0 ? 'Canasta vacía' : workloadInfo.label.split('(')[0].trim()}
            </div>
          </div>

          <button
            type="button"
            data-testid="planner-open-basket-btn"
            onClick={() => setIsMobileBasketOpen(true)}
            className="px-3.5 py-2.5 min-h-[44px] rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all flex items-center gap-1.5 shrink-0"
          >
            <span>Ver selección</span>
            {basketSubjects.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-950/20 text-slate-950 font-extrabold text-[10px]">
                {basketSubjects.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Mobile Basket Bottom Sheet */}
      <BottomSheet
        isOpen={isMobile && isMobileBasketOpen}
        onClose={() => setIsMobileBasketOpen(false)}
        title="Mi Selección del Cuatrimestre"
      >
        <div className="space-y-4 p-1">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs text-slate-400">
              {basketSubjects.length} {basketSubjects.length === 1 ? 'materia' : 'materias'} elegidas
            </span>
            {basketSubjects.length > 0 && (
              <button
                type="button"
                onClick={clearBasket}
                className="px-2.5 py-1.5 min-h-[44px] rounded-lg text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1 text-xs"
              >
                <Trash2 className="w-4 h-4" />
                <span>Vaciar</span>
              </button>
            )}
          </div>

          {/* Total Hours Metric Card */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Carga horaria semanal total:</span>
              <span className="text-2xl font-black text-cyan-400">{totalWeeklyHours} hs</span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          {/* Workload evaluation tag */}
          <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${workloadInfo.bg} ${workloadInfo.color}`}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{workloadInfo.label}</span>
          </div>

          {/* Chosen subjects items */}
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {basketSubjects.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">
                Todavía no agregaste materias. Tocá "Sumar" en cualquiera de las disponibles.
              </p>
            ) : (
              basketSubjects.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs gap-2"
                >
                  <div className="pr-2 leading-tight flex-1 min-w-0">
                    <span className="font-bold text-white block break-words">{s.name}</span>
                    <span className="text-slate-500 text-[10px]">
                      #{s.code} • {s.modality} • {s.weeklyHours}hs
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleBasketSubject(s.id)}
                    className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-400"
                    aria-label={`Quitar ${s.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Action buttons */}
          <div className="pt-2 border-t border-slate-800 space-y-2.5">
            {onNavigateToSchedule && (
              <button
                type="button"
                onClick={() => {
                  setIsMobileBasketOpen(false);
                  onNavigateToSchedule();
                }}
                disabled={basketSubjects.length === 0}
                className="w-full py-3 min-h-[44px] rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 disabled:opacity-40 text-indigo-300 hover:text-white font-bold text-xs transition-all flex items-center justify-center gap-2"
              >
                <Clock className="w-4 h-4 text-indigo-400" />
                <span>Armar horarios con esta canasta 🕒</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                handleStartTakingAll();
                setIsMobileBasketOpen(false);
              }}
              disabled={basketSubjects.length === 0}
              className="w-full py-3 min-h-[44px] rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 text-white font-bold text-xs shadow-lg shadow-cyan-600/20 transition-all flex items-center justify-center gap-2"
            >
              <PlayCircle className="w-4 h-4" />
              <span>Marcar todas como "Cursando"</span>
            </button>
          </div>
        </div>
      </BottomSheet>
"""

# Insert before the last </div>
last_div_idx = content.rfind('    </div>\n  );')
if last_div_idx != -1:
    content = content[:last_div_idx] + floating_bar_code + content[last_div_idx:]

with open('src/components/planner/SemesterPlanner.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("SemesterPlanner patched successfully")

