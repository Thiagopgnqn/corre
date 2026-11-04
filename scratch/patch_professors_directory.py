with open('src/components/professors/ProfessorsDirectory.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add useIsMobile and BottomSheet import
if 'useIsMobile' not in content:
    content = content.replace(
        "import { useCareer } from '../../context/CareerContext';",
        "import { useCareer } from '../../context/CareerContext';\nimport { useIsMobile } from '../../hooks/useIsMobile';\nimport { BottomSheet } from '../common/BottomSheet';"
    )

# Add isMobile & isMobileFilterOpen state
if 'isMobileFilterOpen' not in content:
    content = content.replace(
        "const [sortBy, setSortBy] = useState<'rating' | 'reviews' | 'name'>('rating');",
        "const [sortBy, setSortBy] = useState<'rating' | 'reviews' | 'name'>('rating');\n  const isMobile = useIsMobile();\n  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState<boolean>(false);"
    )

# Search input font size >= 16px to prevent iOS zoom
content = content.replace(
    'className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"',
    'className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-base sm:text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"'
)

# Search container: add mobile filter button alongside search input
search_and_mobile_btn = """        {/* Buscador + Botón Filtros en Mobile */}
        <div className="flex items-center gap-2 flex-1 w-full">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar docente o materia..."
              className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-base sm:text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Botón Filtros visible en mobile */}
          <button
            type="button"
            onClick={() => setIsMobileFilterOpen(true)}
            className="md:hidden px-3 py-2 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-slate-200 flex items-center gap-1.5 shrink-0"
          >
            <Filter className="w-4 h-4 text-indigo-400" />
            <span>Filtros</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-indigo-500 ring-2 ring-slate-950" />
            )}
          </button>
        </div>"""

content = content.replace(
    """        {/* Buscador */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar docente por apellido, nombre o materia..."
            className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>""",
    search_and_mobile_btn
)

# Desktop controls: wrap with hidden md:flex
content = content.replace(
    '        {/* Controles de filtro y orden */}\n        <div className="flex flex-wrap items-center gap-2 text-xs">',
    '        {/* Controles de filtro y orden en Desktop */}\n        <div className="hidden md:flex flex-wrap items-center gap-2 text-xs">'
)

# Append Mobile BottomSheet for filters before closing div
mobile_filter_sheet = """
      {/* BottomSheet de Filtros para Mobile */}
      <BottomSheet
        isOpen={isMobile && isMobileFilterOpen}
        onClose={() => setIsMobileFilterOpen(false)}
        title="Filtros del Directorio"
      >
        <div className="space-y-4 p-1">
          {/* Materia */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 block">Materia</label>
            <select
              aria-label="Filtrar por materia en mobile"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 min-h-[44px] text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Todas las materias</option>
              {allPlanSubjects.map((sub) => (
                <option key={sub.id} value={String(sub.code)}>
                  {sub.level}° · {sub.name}
                </option>
              ))}
            </select>
          </div>

          {/* Puntaje mínimo */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 block">Valoración mínima</label>
            <select
              aria-label="Valoración mínima en mobile"
              value={minRatingFilter}
              onChange={(e) => setMinRatingFilter(Number(e.target.value))}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 min-h-[44px] text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value={0}>Cualquier puntaje</option>
              <option value={3.5}>★ 3,5 o más</option>
              <option value={4}>★ 4,0 o más</option>
              <option value={4.5}>★ 4,5 o más</option>
            </select>
          </div>

          {/* Orden */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 block">Ordenar por</label>
            <select
              aria-label="Ordenar profesores en mobile"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'rating' | 'reviews' | 'name')}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 min-h-[44px] text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="rating">Mejor valorados</option>
              <option value="reviews">Más reseñas</option>
              <option value="name">Nombre (A-Z)</option>
            </select>
          </div>

          {/* Solo con reseñas */}
          <button
            type="button"
            onClick={() => setWithReviewsOnly(!withReviewsOnly)}
            className={`w-full px-3 py-2.5 min-h-[44px] rounded-xl border font-semibold flex items-center justify-between transition-all cursor-pointer ${
              withReviewsOnly
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Mostrar solo con reseñas</span>
            </span>
            <span className={`w-4 h-4 rounded-md border flex items-center justify-center ${withReviewsOnly ? 'bg-amber-500 border-amber-400 text-slate-950' : 'border-slate-700 bg-slate-900'}`}>
              {withReviewsOnly && '✓'}
            </span>
          </button>

          {/* Acciones */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3.5 py-2.5 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpiar</span>
              </button>
            ) : <div />}

            <button
              type="button"
              onClick={() => setIsMobileFilterOpen(false)}
              className="px-5 py-2.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center cursor-pointer"
            >
              <span>Aplicar filtros ({professors.length})</span>
            </button>
          </div>
        </div>
      </BottomSheet>
"""

# Insert before closing div of ProfessorsDirectory
idx = content.rfind('    </div>\n  );')
if idx != -1:
    content = content[:idx] + mobile_filter_sheet + content[idx:]

with open('src/components/professors/ProfessorsDirectory.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("ProfessorsDirectory patched successfully")

