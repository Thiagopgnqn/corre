/**
 * Normalización, análisis y detección de duplicados de nombres de profesores.
 * Soporta formato "Apellido, Nombre", comparación insensible al orden de palabras,
 * detección de formatos anómalos y propuestas de duplicados sin unificaciones riesgosas.
 */

export interface ParsedProfessorName {
  raw: string;
  cleanDisplay: string;
  normalizedKey: string; // tokens alfabéticos ordenados unidos por espacio (insensible al orden)
  tokens: string[];
  surnameTokens: string[];
  givenTokens: string[];
  hasComma: boolean;
  anomalies: string[];
}

export type DuplicateMatchKind = 'exact' | 'proposed_same' | 'same_surname_diff_given' | 'phonetic_variant';

export interface DuplicateCandidate {
  professorA: { displayName: string; normalizedKey: string; rawAliases: string[] };
  professorB: { displayName: string; normalizedKey: string; rawAliases: string[] };
  kind: Exclude<DuplicateMatchKind, 'exact'>;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Quita tildes/diacríticos, apóstrofes pegados a apellidos (ej. D´Agostino -> dagostino),
 * signos de puntuación y espacios sobrantes, pasando todo a minúsculas.
 */
export function normalizeTextTokenizable(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Unir apóstrofes internos entre letras: D'Agostino / D´Agostino -> dagostino
    .replace(/([a-z])['´`’]([a-z])/g, '$1$2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clave fonética española aproximada para detectar variantes como "Karina" vs "Carina",
 * "Velez" vs "Beles", "Zea" vs "Sea".
 */
export function spanishPhoneticToken(token: string): string {
  return token
    .replace(/^h/, '')
    .replace(/qu/g, 'k')
    .replace(/c([ei])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/ll/g, 'y')
    .replace(/(.)\1+/g, '$1');
}

/**
 * Distancia de edición Levenshtein simple para tokens cortos/medianos.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = temp;
    }
  }
  return dp[a.length];
}

/**
 * Limpia espacios repetidos conservando la capitalización original prolija para mostrar.
 */
export function cleanDisplayName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

/**
 * Elige el mejor display_name entre varios alias crudos del mismo profesor:
 * prioriza formato con coma ("Apellido, Nombre"), con tildes y mayor riqueza de caracteres.
 */
export function pickBestDisplayName(aliases: string[]): string {
  if (aliases.length === 0) return '';
  const cleaned = aliases.map(cleanDisplayName).filter(Boolean);
  cleaned.sort((a, b) => {
    const aComma = a.includes(',') ? 1 : 0;
    const bComma = b.includes(',') ? 1 : 0;
    if (aComma !== bComma) return bComma - aComma;
    const aAccents = (a.match(/[áéíóúÁÉÍÓÚñÑüÜ]/g) || []).length;
    const bAccents = (b.match(/[áéíóúÁÉÍÓÚñÑüÜ]/g) || []).length;
    if (aAccents !== bAccents) return bAccents - aAccents;
    return b.length - a.length;
  });
  return cleaned[0];
}

/**
 * Parsea un nombre crudo de profesor, detecta anomalías de formato y genera
 * su clave canónica `normalizedKey` insensible al orden de las palabras.
 */
export function parseProfessorName(raw: string): ParsedProfessorName {
  const trimmed = raw.trim();
  const anomalies: string[] = [];

  if (/[;/|&]/.test(trimmed)) {
    anomalies.push('Contiene separador múltiple (; / | &): posible celda con más de un docente');
  }
  const commaCount = (trimmed.match(/,/g) || []).length;
  if (commaCount === 0) {
    anomalies.push('No respeta formato "Apellido, Nombre" (sin coma)');
  } else if (commaCount > 1) {
    anomalies.push('Contiene múltiples comas');
  }
  if (/\d/.test(trimmed)) {
    anomalies.push('Contiene dígitos numéricos');
  }
  if (/[()]/.test(trimmed)) {
    anomalies.push('Contiene paréntesis o anotaciones extra');
  }
  if (/['´`’]/.test(trimmed)) {
    anomalies.push('Contiene apóstrofe o tilde suelta como carácter');
  }

  const hasComma = commaCount >= 1;
  let surnameTokens: string[] = [];
  let givenTokens: string[] = [];

  if (hasComma) {
    const idx = trimmed.indexOf(',');
    const rawSurname = trimmed.slice(0, idx);
    const rawGiven = trimmed.slice(idx + 1);
    surnameTokens = normalizeTextTokenizable(rawSurname).split(' ').filter(Boolean);
    givenTokens = normalizeTextTokenizable(rawGiven).split(' ').filter(Boolean);
  } else {
    const all = normalizeTextTokenizable(trimmed).split(' ').filter(Boolean);
    surnameTokens = all.slice(0, 1);
    givenTokens = all.slice(1);
  }

  const allTokens = [...surnameTokens, ...givenTokens];
  if (allTokens.length < 2) {
    anomalies.push('Nombre incompleto (menos de 2 palabras)');
  }

  // Clave canónica insensible al orden de las palabras (deduplicando tokens repetidos)
  const uniqueSortedTokens = Array.from(new Set(allTokens)).sort();
  const normalizedKey = uniqueSortedTokens.join(' ');

  return {
    raw: trimmed,
    cleanDisplay: cleanDisplayName(trimmed),
    normalizedKey,
    tokens: uniqueSortedTokens,
    surnameTokens,
    givenTokens,
    hasComma,
    anomalies,
  };
}

/**
 * Compara dos nombres de docentes y clasifica su relación:
 * - 'exact': mismos tokens normalizados en cualquier orden (ej. "Botta, Oscar" y "Oscar, Botta")
 * - 'proposed_same': subconjunto de >= 2 tokens sin contradicción (ej. "Botta, Oscar Ernesto" y "Oscar, Botta",
 *   o "Romoli, Irene" y "Romoli, Irene Esther"). Se propone como el mismo docente sin fusionar a ciegas.
 * - 'phonetic_variant': coincidencia fonética/ortográfica fuerte (ej. "Arrua, Karina" y "Arrúa, Ruth Carina").
 * - 'same_surname_diff_given': mismo apellido principal con nombres de pila distintos (ej. "Romero, Rubén" y "Romero, María").
 * - null: docentes distintos sin relación.
 */
export function compareProfessorParsed(
  a: ParsedProfessorName,
  b: ParsedProfessorName
): { kind: DuplicateMatchKind; confidence: 'high' | 'medium' | 'low'; reason: string } | null {
  if (!a.normalizedKey || !b.normalizedKey) return null;

  if (a.normalizedKey === b.normalizedKey) {
    return {
      kind: 'exact',
      confidence: 'high',
      reason: 'Coincidencia exacta de palabras normalizadas (insensible al orden y tildes)',
    };
  }

  const setA = new Set(a.tokens);
  const setB = new Set(b.tokens);
  const smaller = setA.size <= setB.size ? a.tokens : b.tokens;
  const largerSet = setA.size <= setB.size ? setB : setA;

  // Subconjunto completo de >= 2 tokens (ej. {"botta", "oscar"} c {"botta", "ernesto", "oscar"})
  if (smaller.length >= 2 && smaller.every((t) => largerSet.has(t))) {
    return {
      kind: 'proposed_same',
      confidence: 'high',
      reason: `Todos los tokens (${smaller.join(', ')}) están contenidos en el otro nombre (posible segundo nombre omitido u orden invertido)`,
    };
  }

  // Comparación fonética / distancia 1 por subconjunto de >= 2 tokens (ej. "Arrua, Karina" vs "Arrúa, Ruth Carina")
  const phonSmaller = smaller.map(spanishPhoneticToken);
  const phonLarger = Array.from(largerSet).map(spanishPhoneticToken);
  if (
    phonSmaller.length >= 2 &&
    phonSmaller.every((pt) =>
      phonLarger.some((lt) => lt === pt || (pt.length >= 5 && levenshtein(pt, lt) <= 1))
    )
  ) {
    return {
      kind: 'phonetic_variant',
      confidence: 'medium',
      reason: 'Coincidencia fonética/ortográfica en apellido y nombre con variante de escritura o segundo nombre',
    };
  }

  // Mismo apellido principal pero nombres distintos -> NO unificar, listar como posible duplicado / homónimo
  const primarySurnameA = a.surnameTokens[0];
  const primarySurnameB = b.surnameTokens[0];
  if (
    primarySurnameA &&
    primarySurnameB &&
    primarySurnameA.length >= 3 &&
    (primarySurnameA === primarySurnameB ||
      spanishPhoneticToken(primarySurnameA) === spanishPhoneticToken(primarySurnameB))
  ) {
    // Verificar si comparten al menos un nombre de pila
    const sharedGiven = a.givenTokens.filter((g) => b.givenTokens.includes(g));
    if (sharedGiven.length > 0) {
      const extraA = a.givenTokens.filter((g) => !b.givenTokens.includes(g));
      const extraB = b.givenTokens.filter((g) => !a.givenTokens.includes(g));
      // Si ambos tienen segundos nombres distintos (ej. "Rubén Aníbal" vs "Ruben Orlando"), son personas distintas
      if (extraA.length > 0 && extraB.length > 0) {
        return {
          kind: 'same_surname_diff_given',
          confidence: 'low',
          reason: `Mismo apellido (${primarySurnameA}) y primer nombre (${sharedGiven.join(', ')}), pero segundos nombres distintos (${extraA.join(' ')} vs ${extraB.join(' ')})`,
        };
      }
      return {
        kind: 'proposed_same',
        confidence: 'medium',
        reason: `Mismo apellido (${primarySurnameA}) y nombre compartido (${sharedGiven.join(', ')}) con apellido compuesto u omisión parcial`,
      };
    }

    return {
      kind: 'same_surname_diff_given',
      confidence: 'low',
      reason: `Mismo apellido (${primarySurnameA}) con nombres de pila distintos`,
    };
  }

  return null;
}

export interface NormalizationSimulationResult {
  totalRawOccurrences: number;
  distinctRawStrings: number;
  uniqueProfessors: Array<{
    displayName: string;
    normalizedKey: string;
    rawAliases: string[];
    occurrencesCount: number;
    parsed: ParsedProfessorName;
  }>;
  exactMerges: Array<{
    normalizedKey: string;
    displayName: string;
    mergedRawStrings: string[];
  }>;
  proposedSameCandidates: DuplicateCandidate[];
  possibleDuplicatesSameSurname: DuplicateCandidate[];
  anomalousNames: Array<{
    raw: string;
    anomalies: string[];
  }>;
}

/**
 * Ejecuta en memoria el análisis completo de unificación y detección de posibles duplicados
 * sobre una lista de nombres crudos de docentes.
 */
export function analyzeProfessorNames(rawNames: string[]): NormalizationSimulationResult {
  const validRaw = rawNames.map((n) => n.trim()).filter(Boolean);
  const byNormalizedKey = new Map<
    string,
    { rawSet: Set<string>; count: number; sampleParsed: ParsedProfessorName }
  >();
  const anomalousMap = new Map<string, string[]>();

  for (const raw of validRaw) {
    const parsed = parseProfessorName(raw);
    if (!parsed.normalizedKey) continue;

    if (parsed.anomalies.length > 0 && !anomalousMap.has(parsed.raw)) {
      anomalousMap.set(parsed.raw, parsed.anomalies);
    }

    const existing = byNormalizedKey.get(parsed.normalizedKey);
    if (existing) {
      existing.rawSet.add(parsed.raw);
      existing.count += 1;
    } else {
      byNormalizedKey.set(parsed.normalizedKey, {
        rawSet: new Set([parsed.raw]),
        count: 1,
        sampleParsed: parsed,
      });
    }
  }

  const uniqueProfessors = Array.from(byNormalizedKey.entries())
    .map(([normalizedKey, entry]) => {
      const rawAliases = Array.from(entry.rawSet).sort();
      const displayName = pickBestDisplayName(rawAliases);
      return {
        displayName,
        normalizedKey,
        rawAliases,
        occurrencesCount: entry.count,
        parsed: parseProfessorName(displayName),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

  const exactMerges = uniqueProfessors
    .filter((p) => p.rawAliases.length > 1)
    .map((p) => ({
      normalizedKey: p.normalizedKey,
      displayName: p.displayName,
      mergedRawStrings: p.rawAliases,
    }));

  const proposedSameCandidates: DuplicateCandidate[] = [];
  const possibleDuplicatesSameSurname: DuplicateCandidate[] = [];

  for (let i = 0; i < uniqueProfessors.length; i++) {
    for (let j = i + 1; j < uniqueProfessors.length; j++) {
      const profA = uniqueProfessors[i];
      const profB = uniqueProfessors[j];
      const cmp = compareProfessorParsed(profA.parsed, profB.parsed);
      if (!cmp || cmp.kind === 'exact') continue;

      const candidate: DuplicateCandidate = {
        professorA: {
          displayName: profA.displayName,
          normalizedKey: profA.normalizedKey,
          rawAliases: profA.rawAliases,
        },
        professorB: {
          displayName: profB.displayName,
          normalizedKey: profB.normalizedKey,
          rawAliases: profB.rawAliases,
        },
        kind: cmp.kind,
        confidence: cmp.confidence,
        reason: cmp.reason,
      };

      if (cmp.kind === 'proposed_same' || cmp.kind === 'phonetic_variant') {
        proposedSameCandidates.push(candidate);

        // Detectar si uno de los dos tiene apellido/nombre invertidos respecto al otro (ej. "Oscar, Botta" vs "Botta, Oscar Ernesto")
        if (
          profA.parsed.hasComma &&
          profB.parsed.hasComma &&
          profA.parsed.surnameTokens.length > 0 &&
          profB.parsed.surnameTokens.length > 0
        ) {
          const aSurnameInBGiven = profA.parsed.surnameTokens.every((t) =>
            profB.parsed.givenTokens.includes(t)
          );
          const bSurnameInAGiven = profB.parsed.surnameTokens.every((t) =>
            profA.parsed.givenTokens.includes(t)
          );
          if (aSurnameInBGiven && bSurnameInAGiven) {
            const shorter =
              profA.parsed.tokens.length <= profB.parsed.tokens.length ? profA : profB;
            const longer = shorter === profA ? profB : profA;
            const msg = `Posible orden invertido "Nombre, Apellido" respecto a "${longer.displayName}"`;
            const list = anomalousMap.get(shorter.displayName) || [];
            if (!list.includes(msg)) {
              anomalousMap.set(shorter.displayName, [...list, msg]);
            }
          }
        }
      } else {
        possibleDuplicatesSameSurname.push(candidate);
      }
    }
  }

  const anomalousNames = Array.from(anomalousMap.entries())
    .map(([raw, anomalies]) => ({ raw, anomalies }))
    .sort((a, b) => a.raw.localeCompare(b.raw, 'es'));

  return {
    totalRawOccurrences: validRaw.length,
    distinctRawStrings: new Set(validRaw).size,
    uniqueProfessors,
    exactMerges,
    proposedSameCandidates,
    possibleDuplicatesSameSurname,
    anomalousNames,
  };
}
