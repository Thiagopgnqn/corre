export function normalizeSubjectName(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^\w\s]/g, ' ') // remove special chars
    .replace(/\s+/g, ' ')
    .trim();
}

export const SUBJECT_ALIASES: Record<string, number> = {
  // 1er año
  'analisis matematico 1': 1,
  'analisis 1': 1,
  'algebra y geometria analitica': 2,
  'algebra': 2,
  'fisica 1': 3,
  'ingles 1': 4,
  'ingles': 4,
  'logica y estructuras discretas': 5,
  'logica y estructuras discretas 8 a 12 50': 5,
  'led': 5,
  'algoritmos y estructuras de datos': 6,
  'algortimos y estructuras de datos': 6,
  'aed': 6,
  'arquitectura de computadoras': 7,
  'aco': 7,
  'sistemas y procesos de negocio': 8,
  'sistemas y procesos de negocios': 8,
  'sitemas y procesos de negocios': 8,
  'spn': 8,
  'ingenieria y sociedad': 11,

  // 2do año
  'analisis matematico 2': 9,
  'analisis 2': 9,
  'fisica 2': 10,
  'ingles 2': 12,
  'sintaxis y semantica de los lenguajes': 13,
  'sintaxis y semantica': 13,
  'ssl': 13,
  'paradigmas de programacion': 14,
  'ppr': 14,
  'sistemas operativos': 15,
  'sop': 15,
  'so': 15,
  'analisis de sistemas de informacion': 16,
  'analisis de sistemas': 16,
  'asi': 16,
  'as': 16,
  'probabilidad y estadisticas': 17,
  'probabilidad y estadistica': 17,
  'probabilidad y estadisitica': 17,
  'pye': 17,

  // 3er año
  'economia': 18,
  'eco': 18,
  'bases de datos': 19,
  'base de datos': 19,
  'bda': 19,
  'desarrollo de software': 20,
  'dds': 20,
  'comunicacion de datos': 21,
  'com': 21,
  'analisis numerico': 22,
  'anu': 22,
  'diseno de sistemas de informacion': 23,
  'diseno de sistemas': 23,
  'dsi': 23,
  'seminario integrador analista': 99,
  'seminario integrador': 99,
  'seminario': 99,

  // 4to año
  'legislacion': 24,
  'leg': 24,
  'ingenieria y calidad de software': 25,
  'ics': 25,
  'redes de datos': 26,
  'red': 26,
  'investigacion operativa': 27,
  'iop': 27,
  'simulacion': 28,
  'sim': 28,
  'tecnologias para la automatizacion': 29,
  'tecnologia para la automatizacion': 29,
  'tpa': 29,
  'administracion de sistemas de informacion': 30,
  'administracion de sistemas': 30,
  'adsi': 30,

  // 5to año
  'inteligencia artificial': 31,
  'ia': 31,
  'iar': 31,
  'ciencia de datos': 32,
  'cd': 32,
  'ccd': 32,
  'sistemas de gestion': 33,
  'sg': 33,
  'gestion gerencial': 34,
  'gg': 34,
  'seguridad en los sistemas de informacion': 35,
  'seguridad en los sistemas': 35,
  'ssi': 35,
  'proyecto final': 36,

  // Electivas (Plan oficial)
  'backend de aplicaciones': 301,
  'elec backend': 301,
  'green software': 401,
  'gestion industrial de la produccion': 402,
  'gip': 402,
  'gestion de la mejora de los procesos': 403,
  'gestion de la mejora de procesos': 403,
  'gmp': 403,
  'desarrollo y operaciones devops': 404,
  'devops': 404,
  'desarrollo de aplicaciones con objetos': 405,
  'desarrollo de aplicaciones': 405,
  'dao': 405,
  'comunicacion multimedial en el desarrollo de sistemas de informacion': 406,
  'comunicacion multimedial en el desarrollo de sistemas': 406,
  'arquitectura de software': 407,
  'desarrollo de tecnologias blockchain': 501,
  'desarrollo con tecnologias blockchain': 501,
  'blockchain': 501,
  'creatividad e innovacion en ingenieria': 502,
  'creatividad e innovacion': 502,
  'auditoria de si ti': 503,
  'gerenciamiento estrategico': 504,
  'consultoria en negocios digitales': 505,
  'emprendimientos tecnologicos': 506,
  'decisiones en escenarios complejos': 507,
  'decisiones en escenarios complejos electiva': 507,
  'dec': 507,
  'testing de software': 508,
  'seguridad en el desarrollo de software': 509,
  'seguridad en el desarrollo de software electiva': 509,
  'seguridad en el desarrollo de software electiva 4k2a': 509,
  'seguridad en el desarrollo de software electiva 4k3a': 509,
  'sds': 509,
  'integracion de aplicaciones en entorno web': 510,
  'ingenieria de software de fuentes abiertas libres': 511,
  'ingenieria de software de fuentes abierrtas libre': 511,
  'ingenieria de software': 511,

  // Nuevas Electivas incorporadas (IDs con prefijo X- en catálogo)
  'experiencia e interfaces de usuario': 408,
  'experiencia e interfaces de usuario electiva': 408,
  'experiencia e interfaces de usuario electiva 4k1a': 408,
  'experiencia e interfaces de usuario electiva 4k1b': 408,
  'uix': 408,
  'ui ux': 408,
  'x 408': 408,
  'x uix': 408,

  'habilidades blandas': 512,
  'hb': 512,
  'x 512': 512,
  'x hb': 512,

  'creatividad y desarrollo de entornos virtuales': 513,
  'cdev': 513,
  'entornos virtuales': 513,
  'x 513': 513,
  'x cdev': 513,

  'practica profesional supervisada': 514,
  'pps': 514,
  'x 514': 514,
  'x pps': 514,
};

export function resolveSubjectId(rawName: string): number | null {
  if (!rawName) return null;
  const normalized = normalizeSubjectName(rawName);
  if (SUBJECT_ALIASES[normalized] !== undefined) {
    return SUBJECT_ALIASES[normalized];
  }
  return null;
}

export function resolveSubjectIds(rawName: string): number[] {
  if (!rawName) return [];
  const single = resolveSubjectId(rawName);
  if (single !== null) return [single];

  const normalized = normalizeSubjectName(rawName);

  // Caso combinado documentado: AED y SPN en 1K15 (celdas E28, E30, H30)
  if (
    normalized === 'aed spn' ||
    normalized === 'algoritmos y estructuras de datos spn' ||
    normalized.includes('algoritmos y estructuras de datos spn') ||
    normalized.includes('aed spn')
  ) {
    return [6, 8];
  }

  // Descomposición por líneas
  const lines = rawName.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1) {
    const ids: number[] = [];
    for (const line of lines) {
      const id = resolveSubjectId(line);
      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }
    if (ids.length > 0) return ids;
  }

  return [];
}

export function isGenericElective(rawName: string): boolean {
  if (!rawName) return false;
  const norm = normalizeSubjectName(rawName);
  // Si ya mapea a una electiva específica con nombre propio, no es genérica
  if (SUBJECT_ALIASES[norm] !== undefined) return false;

  return (
    norm.startsWith('elect') ||
    norm === 'electiva' ||
    /^e\s*\d+/.test(norm) ||
    norm.startsWith('electiva 1') ||
    norm.startsWith('electiva 2') ||
    norm.startsWith('electiva 3') ||
    norm.startsWith('electiva 4') ||
    norm.startsWith('electiva 5')
  );
}
