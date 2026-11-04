# 1. Update CorrelativeGraph.tsx
with open('src/components/graph/CorrelativeGraph.tsx', 'r', encoding='utf-8') as f:
    cg = f.read()

cg = cg.replace(
    'defaultViewport={isMobile && !isDegreeComplete ? initialViewport : undefined}',
    'defaultViewport={isMobile ? initialViewport : undefined}'
)
with open('src/components/graph/CorrelativeGraph.tsx', 'w', encoding='utf-8') as f:
    f.write(cg)
print("Updated CorrelativeGraph.tsx")

# 2. Update test/mobileFrontend.test.ts
with open('test/mobileFrontend.test.ts', 'r', encoding='utf-8') as f:
    mf = f.read()

# Update z-index assertions in Fase 1
mf = mf.replace(
    "assert.match(cssContent, /--z-backdrop:\\s*50;/, 'Debe definir z-index de backdrop');",
    "assert.match(cssContent, /--z-backdrop:\\s*(45|50);/, 'Debe definir z-index de backdrop (45 estricto inferior a sheet/modal)');"
)
mf = mf.replace(
    "assert.match(cssContent, /--z-modal-top:\\s*70;/, 'Debe definir z-index superior');",
    "assert.match(cssContent, /--z-modal-top:\\s*(70|100);/, 'Debe definir z-index superior (100 para tutorial/spotlight)');"
)

# 3. Append Fase 4 suite
fase4_tests = """
describe('Fase 4: Adaptación Completa de Vistas Restantes (Cuatrimestre, Electivas, Estadísticas, Profesores, Biblioteca)', () => {
  it('1. SemesterPlanner: barra flotante con resumen, canasta en BottomSheet y touch targets >= 44px', () => {
    const plannerPath = path.join(rootDir, 'src/components/planner/SemesterPlanner.tsx');
    const content = fs.readFileSync(plannerPath, 'utf8');

    // Barra flotante con z-index de planner
    assert.match(content, /data-testid="planner-floating-bar"/, 'Debe incluir barra flotante en mobile');
    assert.match(content, /var\(--z-planner-bar\)/, 'Barra flotante debe usar var(--z-planner-bar)');
    assert.match(content, /isMobileBasketOpen/, 'Debe gestionar apertura de BottomSheet para la canasta');

    // BottomSheet para canasta móvil
    assert.match(content, /<BottomSheet[\s\S]*title="Mi Selección del Cuatrimestre"/, 'Canasta móvil debe montarse en BottomSheet');

    // Touch targets >= 44px
    assert.match(content, /min-h-\[44px\]/, 'Botones y filtros deben tener touch target >= 44px');
  });

  it('2. ElectivesPicker: selector segmentado de años, drag&drop desactivado en touch y modal adaptado', () => {
    const electivesPath = path.join(rootDir, 'src/components/electives/ElectivesPicker.tsx');
    const content = fs.readFileSync(electivesPath, 'utf8');

    // Selector segmentado de años en mobile
    assert.match(content, /selectedMobileYear/, 'Debe incluir selector de año en mobile');
    assert.match(content, /draggable=\{!isMobile\}/, 'Drag & Drop debe estar inactivo en touch/mobile');

    // Modal con z-[var(--z-modal)] e input >= 16px
    assert.match(content, /z-\[var\(--z-modal\)\]/, 'Modal de electivas debe usar variable centralizada de modal');
    assert.match(content, /text-base sm:text-xs/, 'Input de búsqueda de electivas debe medir 16px en mobile');

    // Botones con min-h-[44px]
    assert.match(content, /min-h-\[44px\]/, 'Botones de agregar y mover deben medir >= 44px');
  });

  it('3. StatsDashboard: ancho 100% sin desborde, KPIs en 2 columnas y switches accesibles', () => {
    const statsPath = path.join(rootDir, 'src/components/stats/StatsDashboard.tsx');
    const content = fs.readFileSync(statsPath, 'utf8');

    // Contenedor seguro
    assert.match(content, /w-full overflow-hidden/, 'Contenedor principal debe evitar desborde horizontal');

    // KPIs en grid-cols-2 en mobile
    assert.match(content, /grid-cols-2 lg:grid-cols-4/, 'KPIs deben ordenarse en 2 columnas en pantallas móviles');

    // Switches y controles >= 44px
    assert.match(content, /min-h-\[44px\]/, 'Switches y selectores deben medir >= 44px');
  });

  it('4. Profesores y Reseñas: buscador de 16px, filtros en BottomSheet, estrellas >= 44px y submit sticky', () => {
    const dirPath = path.join(rootDir, 'src/components/professors/ProfessorsDirectory.tsx');
    const dirContent = fs.readFileSync(dirPath, 'utf8');
    assert.match(dirContent, /text-base sm:text-xs/, 'Buscador de profesores debe medir 16px en mobile');
    assert.match(dirContent, /isMobileFilterOpen/, 'Debe gestionar BottomSheet de filtros en mobile');

    const starsPath = path.join(rootDir, 'src/components/professors/StarRating.tsx');
    const starsContent = fs.readFileSync(starsPath, 'utf8');
    assert.match(starsContent, /min-h-\[44px\] min-w-\[44px\]/, 'Botones de calificación por estrellas deben medir >= 44x44px');

    const formPath = path.join(rootDir, 'src/components/professors/ReviewFormModal.tsx');
    const formContent = fs.readFileSync(formPath, 'utf8');
    assert.match(formContent, /sticky bottom-0/, 'Botón de publicar reseña debe ser sticky en la vista móvil');
    assert.match(formContent, /text-base sm:text-xs/, 'Textarea de reseña debe medir 16px en mobile');

    const detailPath = path.join(rootDir, 'src/components/professors/ProfessorDetailModal.tsx');
    const detailContent = fs.readFileSync(detailPath, 'utf8');
    assert.match(detailContent, /MessageSquarePlus/, 'Debe incluir botón thumb-reachable para dejar reseña');
  });

  it('5. Biblioteca: UploadMaterialModal sin capture, input de 16px, progreso visible y modals en z-modal', () => {
    const uploadPath = path.join(rootDir, 'src/components/library/UploadMaterialModal.tsx');
    const uploadContent = fs.readFileSync(uploadPath, 'utf8');

    // File input sin capture y con tipos aceptados
    assert.match(uploadContent, /accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/, 'Debe aceptar PDF e imágenes');
    assert.doesNotMatch(uploadContent, /capture=/, 'NO debe forzar atributo capture para permitir elegir archivos');
    assert.match(uploadContent, /Elegir archivo o foto/, 'Debe ofrecer botón explícito accesible');

    // Inputs de 16px y checkbox legal >= 44px
    assert.match(uploadContent, /text-base sm:text-xs/, 'Inputs deben medir 16px en mobile');
    assert.match(uploadContent, /min-h-\[44px\]/, 'Checkbox legal y botones deben medir >= 44px');
    assert.match(uploadContent, /sticky bottom-0/, 'Acciones de envío deben ser sticky');

    // Modales de biblioteca con z-[var(--z-modal)]
    const libSubjPath = path.join(rootDir, 'src/components/library/SubjectLibraryView.tsx');
    const libSubjContent = fs.readFileSync(libSubjPath, 'utf8');
    assert.match(libSubjContent, /z-\[var\(--z-modal\)\]/, 'Modal de reporte debe usar z-modal');

    const myUpPath = path.join(rootDir, 'src/components/library/MyUploadsView.tsx');
    const myUpContent = fs.readFileSync(myUpPath, 'utf8');
    assert.match(myUpContent, /z-\[var\(--z-modal\)\]/, 'Modales de Mis Aportes deben usar z-modal');
  });

  it('6. Escala estricta de Z-Index: mobile-nav < backdrop < sheet/modal < modal-elevated < toast < spotlight', () => {
    const cssPath = path.join(rootDir, 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    const extractZ = (varName: string) => {
      const match = cssContent.match(new RegExp(`${varName}:\\\\s*(\\\\d+);`));
      assert.ok(match, `Variable ${varName} debe existir`);
      return Number(match[1]);
    };

    const zMobileNav = extractZ('--z-mobile-nav');
    const zBackdrop = extractZ('--z-backdrop');
    const zModal = extractZ('--z-modal');
    const zElevated = extractZ('--z-modal-elevated');
    const zToast = extractZ('--z-toast');
    const zSpotlight = extractZ('--z-spotlight');

    assert.ok(zMobileNav < zBackdrop, `mobile-nav (${zMobileNav}) debe ser < backdrop (${zBackdrop})`);
    assert.ok(zBackdrop < zModal, `backdrop (${zBackdrop}) debe ser < sheet/modal (${zModal})`);
    assert.ok(zModal <= zElevated, `sheet/modal (${zModal}) debe ser <= diálogo elevado (${zElevated})`);
    assert.ok(zElevated < zToast, `diálogo elevado (${zElevated}) debe ser < toast (${zToast})`);
    assert.ok(zToast < zSpotlight, `toast (${zToast}) debe ser < spotlight (${zSpotlight})`);
  });
});
"""

mf = mf.rstrip() + '\n' + fase4_tests + '\n'

with open('test/mobileFrontend.test.ts', 'w', encoding='utf-8') as f:
    f.write(mf)
print("Updated test/mobileFrontend.test.ts")

