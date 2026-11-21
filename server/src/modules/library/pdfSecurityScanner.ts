import zlib from 'zlib';

/**
 * Límites duros de seguridad y consumo de recursos para el escáner estructural de PDFs.
 * Cualquier superación aborta el análisis en modo fail-closed (rechazo).
 */
export const PDF_SCANNER_LIMITS = Object.freeze({
  MAX_NESTING_DEPTH: 32,
  MAX_REFERENCE_DEPTH: 16,
  MAX_OBJECTS: 50_000,
  MAX_AST_NODES: 250_000,
  MAX_DICT_ENTRIES: 2_000,
  MAX_ARRAY_ELEMENTS: 20_000,
  MAX_TOKEN_BYTES: 4_096,
  MAX_RETAINED_OBJSTM_BYTES: 4 * 1024 * 1024,
  MAX_OBJSTM_COMPRESSED_BYTES: 2 * 1024 * 1024,
  MAX_OBJSTM_INFLATED_BYTES: 4 * 1024 * 1024,
  MAX_OBJSTM_TOTAL_INFLATED_BYTES: 8 * 1024 * 1024,
  MAX_OBJSTM_COUNT: 256,
  MAX_SCAN_DURATION_MS: 10_000,
});

export type PdfRejectionCategory = 'dangerous' | 'protected' | 'unverifiable';

export interface PdfScanResult {
  isSafe: boolean;
  category?: PdfRejectionCategory;
  reasonCode?: string;
  technicalDetail?: string;
  userMessage?: string;
}

const USER_MESSAGES: Record<PdfRejectionCategory, string> = {
  dangerous:
    'Este PDF contiene acciones automáticas o ejecutables bloqueadas por seguridad. Volvé a exportar el PDF o imprimilo a PDF desde tu navegador y subilo de nuevo.',
  protected:
    'PDF protegido: no pudimos verificar su contenido por seguridad. Volvé a exportarlo o imprimilo a PDF desde tu navegador y subilo de nuevo.',
  unverifiable:
    'No pudimos verificar la seguridad de este PDF. Volvé a exportar el PDF o imprimilo a PDF desde tu navegador y subilo de nuevo.',
};

interface PdfNameValue {
  kind: 'name';
  value: string;
}
interface PdfNumberValue {
  kind: 'number';
  value: number;
  isNonNegInt?: boolean;
}
interface PdfBoolValue {
  kind: 'bool';
  value: boolean;
}
interface PdfNullValue {
  kind: 'null';
}
interface PdfStringValue {
  kind: 'string';
}
interface PdfRefValue {
  kind: 'ref';
  obj: number;
  gen: number;
}
interface PdfWordValue {
  kind: 'word';
  value: string;
}
interface PdfArrayValue {
  kind: 'array';
  items: PdfValue[];
}
interface PdfDict {
  kind: 'dict';
  entries: Map<string, PdfValue>;
  duplicates?: Map<string, PdfValue[]>;
  entryCount: number;
}

type PdfValue =
  | PdfNameValue
  | PdfNumberValue
  | PdfBoolValue
  | PdfNullValue
  | PdfStringValue
  | PdfRefValue
  | PdfWordValue
  | PdfArrayValue
  | PdfDict;

const PDF_STRING_SENTINEL: PdfStringValue = Object.freeze({ kind: 'string' });
const PDF_NULL_VALUE: PdfNullValue = Object.freeze({ kind: 'null' });
const PDF_TRUE_VALUE: PdfBoolValue = Object.freeze({ kind: 'bool', value: true });
const PDF_FALSE_VALUE: PdfBoolValue = Object.freeze({ kind: 'bool', value: false });

const ENDSTREAM_BUF = Buffer.from('endstream', 'ascii');
const EMPTY_BUF = Buffer.alloc(0);

type DictFrame = {
  kind: 'dict';
  dict: PdfDict;
  expectingKey: boolean;
  currentKey: string | null;
  pendingNums: number[];
};

type ArrayFrame = {
  kind: 'array';
  items: PdfValue[];
};

type ContainerFrame = DictFrame | ArrayFrame;

type LexerState =
  | 'NORMAL'
  | 'IN_WORD'
  | 'IN_NAME'
  | 'IN_COMMENT'
  | 'IN_LITERAL_STRING'
  | 'IN_HEX_STRING'
  | 'AFTER_LT'
  | 'AFTER_GT'
  | 'STREAM_AFTER_KEYWORD'
  | 'STREAM_AFTER_CR'
  | 'IN_STREAM';

interface CapturedObjStm {
  dict: PdfDict;
  rawData: Buffer;
}

const ALWAYS_FORBIDDEN_ACTION_TYPES = new Set([
  '/Launch',
  '/SubmitForm',
  '/ImportData',
  '/GoToR',
  '/GoToE',
  '/RichMediaExecute',
]);

const ALWAYS_FORBIDDEN_DICT_KEYS = [
  '/Launch',
  '/SubmitForm',
  '/ImportData',
  '/GoToR',
  '/GoToE',
] as const;

const DANGEROUS_NAMED_DESTINATIONS = new Set([
  '/JavaScript',
  '/JS',
  '/Launch',
  '/SubmitForm',
  '/ImportData',
  '/GoToR',
  '/GoToE',
  '/URI',
  '/EmbeddedFile',
]);

const AA_FORBIDDEN_ACTION_TYPES = new Set([
  '/Launch',
  '/SubmitForm',
  '/ImportData',
  '/GoToR',
  '/GoToE',
  '/RichMediaExecute',
  '/URI',
  '/Rendition',
  '/Sound',
  '/Movie',
]);

const VALID_FORM_FT = new Set(['/Tx', '/Btn', '/Ch', '/Sig']);
const SAFE_FORM_AA_TRIGGERS = new Set(['/C', '/F', '/K', '/V']);
const DISALLOWED_FORM_CONTAINER_TYPES = new Set(['/Catalog', '/Page', '/Pages']);

function isPdfWhitespace(b: number): boolean {
  return b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
}

function isPdfDelimiter(b: number): boolean {
  return (
    b === 0x28 || // (
    b === 0x29 || // )
    b === 0x3c || // <
    b === 0x3e || // >
    b === 0x5b || // [
    b === 0x5d || // ]
    b === 0x7b || // {
    b === 0x7d || // }
    b === 0x2f || // /
    b === 0x25 // %
  );
}

function isPdfWhitespaceOrDelimiter(b: number): boolean {
  return isPdfWhitespace(b) || isPdfDelimiter(b);
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

function isHexOrWs(b: number): boolean {
  return hexVal(b) >= 0 || isPdfWhitespace(b);
}

function decodePdfName(rawBytes: number[]): string | null {
  let out = '/';
  for (let i = 0; i < rawBytes.length; i++) {
    const b = rawBytes[i];
    if (b === 0x23) {
      if (i + 2 >= rawBytes.length) return null;
      const h1 = hexVal(rawBytes[i + 1]);
      const h2 = hexVal(rawBytes[i + 2]);
      if (h1 < 0 || h2 < 0) return null;
      const decoded = (h1 << 4) | h2;
      if (decoded === 0) return null;
      out += String.fromCharCode(decoded);
      i += 2;
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

function parseNonNegInt(s: string): number | null {
  if (s.length === 0 || s.length > 16) return null;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return null;
  }
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function parsePdfNumber(s: string): number | null {
  if (s.length === 0 || s.length > 64) return null;
  let i = 0;
  if (s.charCodeAt(0) === 0x2b || s.charCodeAt(0) === 0x2d) {
    i = 1;
    if (i >= s.length) return null;
  }
  let hasDigit = false;
  let hasDot = false;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39) {
      hasDigit = true;
    } else if (c === 0x2e && !hasDot) {
      hasDot = true;
    } else {
      return null;
    }
  }
  if (!hasDigit) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function addDictEntry(dict: PdfDict, key: string, value: PdfValue): boolean {
  if (dict.entryCount >= PDF_SCANNER_LIMITS.MAX_DICT_ENTRIES) {
    return false;
  }
  dict.entryCount++;
  if (dict.entries.has(key)) {
    if (!dict.duplicates) {
      dict.duplicates = new Map();
    }
    let list = dict.duplicates.get(key);
    if (!list) {
      list = [];
      dict.duplicates.set(key, list);
    }
    list.push(value);
  } else {
    dict.entries.set(key, value);
  }
  return true;
}

function getDictValues(dict: PdfDict, key: string): PdfValue[] {
  const first = dict.entries.get(key);
  if (first === undefined) return [];
  const dups = dict.duplicates?.get(key);
  return dups ? [first, ...dups] : [first];
}

function getDictNonNullValues(dict: PdfDict, key: string): PdfValue[] {
  const vals = getDictValues(dict, key);
  if (vals.length === 0) return vals;
  return vals.filter((v) => v.kind !== 'null');
}

function dictHasNameValue(dict: PdfDict, key: string, name: string): boolean {
  const vals = getDictValues(dict, key);
  for (const v of vals) {
    if (v.kind === 'name' && v.value === name) return true;
  }
  return false;
}

function dictAllEntries(dict: PdfDict): Array<[string, PdfValue]> {
  const out: Array<[string, PdfValue]> = [];
  for (const [k, v] of dict.entries) {
    out.push([k, v]);
    const dups = dict.duplicates?.get(k);
    if (dups) {
      for (const dv of dups) {
        out.push([k, dv]);
      }
    }
  }
  return out;
}

function makeFailure(
  category: PdfRejectionCategory,
  reasonCode: string,
  technicalDetail?: string
): PdfScanResult {
  return {
    isSafe: false,
    category,
    reasonCode,
    technicalDetail,
    userMessage: USER_MESSAGES[category],
  };
}

/**
 * Escáner estructural streaming de seguridad para documentos PDF.
 * Opera en O(n) sobre el stream descartando payloads binarios (salvo /ObjStm)
 * y aplica política fail-closed ante errores, truncamiento o límites excedidos.
 */
export class PdfSecurityScanner {
  private readonly startTime = Date.now();
  private state: LexerState = 'NORMAL';
  private bytesProcessed = 0;

  private tokenBytes: number[] = [];
  private stringParenDepth = 0;
  private stringEscaped = false;

  private containerStack: ContainerFrame[] = [];
  private astNodes = 0;
  private totalObjects = 0;

  private topPendingInts: number[] = [];
  private currentObjKey: string | null = null;
  private currentObjValues: PdfValue[] = [];
  private lastCompletedDict: PdfDict | null = null;

  private allDicts: PdfDict[] = [];
  private objectVersions = new Map<string, PdfValue[]>();

  // Estado de stream
  private capturingObjStm = false;
  private currentObjStmDict: PdfDict | null = null;
  private objStmChunks: Buffer[] = [];
  private objStmByteCount = 0;
  private totalRetainedObjStmBytes = 0;
  private capturedObjStms: CapturedObjStm[] = [];
  private streamTail: Buffer = EMPTY_BUF;
  private pendingEndstreamMatch = false;

  // Estado de sub-parser para /ObjStm
  private inObjStmMode = false;
  private objStmValues: PdfValue[] = [];

  private failure: PdfScanResult | null = null;
  private finishedResult: PdfScanResult | null = null;

  private fail(
    category: PdfRejectionCategory,
    reasonCode: string,
    technicalDetail?: string
  ): void {
    if (!this.failure) {
      this.failure = makeFailure(category, reasonCode, technicalDetail);
    }
  }

  private checkDeadline(): boolean {
    if (Date.now() - this.startTime > PDF_SCANNER_LIMITS.MAX_SCAN_DURATION_MS) {
      this.fail('unverifiable', 'SCAN_TIMEOUT', 'Exceeded max scan duration');
      return false;
    }
    return true;
  }

  private bumpAstNodes(): boolean {
    this.astNodes++;
    if (this.astNodes > PDF_SCANNER_LIMITS.MAX_AST_NODES) {
      this.fail('unverifiable', 'MAX_AST_NODES', 'AST node limit exceeded');
      return false;
    }
    return true;
  }

  private bumpObjects(): boolean {
    this.totalObjects++;
    if (this.totalObjects > PDF_SCANNER_LIMITS.MAX_OBJECTS) {
      this.fail('unverifiable', 'MAX_OBJECTS', 'Object count limit exceeded');
      return false;
    }
    return true;
  }

  public feed(chunk: Buffer): void {
    if (this.failure || this.finishedResult) return;

    try {
      if (!Buffer.isBuffer(chunk)) {
        this.fail('unverifiable', 'INVALID_CHUNK', 'Expected Buffer chunk');
        return;
      }
      if (!this.checkDeadline()) return;

      let i = 0;
      const len = chunk.length;
      while (i < len && !this.failure) {
        if ((this.bytesProcessed & 0x0fff) === 0 && !this.checkDeadline()) {
          return;
        }

        if (this.state === 'IN_STREAM') {
          const nextIdx = this.processStreamChunk(chunk, i);
          this.bytesProcessed += nextIdx - i;
          i = nextIdx;
          continue;
        }

        const byte = chunk[i++];
        this.bytesProcessed++;
        this.processByte(byte);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected scanner error';
      this.fail('unverifiable', 'PARSER_EXCEPTION', msg);
    }
  }

  public finish(): PdfScanResult {
    if (this.finishedResult) return this.finishedResult;
    if (this.failure) {
      this.finishedResult = this.failure;
      return this.finishedResult;
    }

    try {
      if (!this.checkDeadline()) {
        this.finishedResult = this.failure!;
        return this.finishedResult;
      }

      // Cerrar tokens pendientes al final del stream (si es válido)
      if (this.state === 'IN_WORD') {
        this.state = 'NORMAL';
        this.flushWord();
      } else if (this.state === 'IN_NAME') {
        this.state = 'NORMAL';
        this.flushName();
      } else if (this.state === 'IN_COMMENT') {
        this.state = 'NORMAL';
      }

      if (this.failure) {
        this.finishedResult = this.failure;
        return this.finishedResult;
      }

      // Cualquier estructura o stream abierto al EOF indica truncamiento -> fail-closed
      if (
        this.state !== 'NORMAL' ||
        this.containerStack.length > 0 ||
        this.currentObjKey !== null
      ) {
        this.fail(
          'unverifiable',
          'TRUNCATED_PDF',
          `Unclosed state=${this.state} depth=${this.containerStack.length} obj=${this.currentObjKey ?? 'none'}`
        );
        this.finishedResult = this.failure!;
        return this.finishedResult;
      }

      const hasEncrypt = this.detectEncrypt();
      this.processObjStms(hasEncrypt);
      if (this.failure) {
        this.finishedResult = this.failure;
        return this.finishedResult;
      }

      this.evaluatePolicy();
      if (this.failure) {
        this.finishedResult = this.failure;
        return this.finishedResult;
      }

      this.finishedResult = { isSafe: true };
      return this.finishedResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected finish error';
      this.fail('unverifiable', 'PARSER_EXCEPTION', msg);
      this.finishedResult = this.failure!;
      return this.finishedResult;
    }
  }

  private processByte(byte: number): void {
    switch (this.state) {
      case 'NORMAL':
        this.handleNormalByte(byte);
        break;
      case 'IN_COMMENT':
        if (byte === 0x0a || byte === 0x0d) {
          this.state = 'NORMAL';
        }
        break;
      case 'IN_LITERAL_STRING':
        this.handleLiteralStringByte(byte);
        break;
      case 'AFTER_LT':
        if (byte === 0x3c) {
          this.state = 'NORMAL';
          this.openDict();
        } else {
          this.state = 'IN_HEX_STRING';
          this.handleHexStringByte(byte);
        }
        break;
      case 'IN_HEX_STRING':
        this.handleHexStringByte(byte);
        break;
      case 'AFTER_GT':
        if (byte === 0x3e) {
          this.state = 'NORMAL';
          this.closeDict();
        } else {
          this.fail('unverifiable', 'MALFORMED_SYNTAX', 'Unexpected single >');
        }
        break;
      case 'IN_NAME':
        if (isPdfWhitespaceOrDelimiter(byte)) {
          this.state = 'NORMAL';
          this.flushName();
          if (!this.failure && !isPdfWhitespace(byte)) {
            this.handleNormalByte(byte);
          }
        } else {
          if (this.tokenBytes.length >= PDF_SCANNER_LIMITS.MAX_TOKEN_BYTES) {
            this.fail('unverifiable', 'TOKEN_TOO_LONG', 'PDF name exceeds max length');
            return;
          }
          this.tokenBytes.push(byte);
        }
        break;
      case 'IN_WORD':
        if (isPdfWhitespaceOrDelimiter(byte)) {
          this.state = 'NORMAL';
          const enteredStreamKeyword = this.flushWord();
          if (!this.failure) {
            if (enteredStreamKeyword) {
              this.processByte(byte);
            } else if (!isPdfWhitespace(byte)) {
              this.handleNormalByte(byte);
            }
          }
        } else {
          if (this.tokenBytes.length >= PDF_SCANNER_LIMITS.MAX_TOKEN_BYTES) {
            this.fail('unverifiable', 'TOKEN_TOO_LONG', 'PDF token exceeds max length');
            return;
          }
          this.tokenBytes.push(byte);
        }
        break;
      case 'STREAM_AFTER_KEYWORD':
        if (byte === 0x20 || byte === 0x09) {
          return;
        }
        if (byte === 0x0a) {
          this.enterStream();
        } else if (byte === 0x0d) {
          this.state = 'STREAM_AFTER_CR';
        } else {
          this.fail('unverifiable', 'MALFORMED_STREAM', 'Invalid byte after stream keyword');
        }
        break;
      case 'STREAM_AFTER_CR':
        if (byte === 0x0a) {
          this.enterStream();
        } else {
          this.enterStream();
          if (!this.failure) {
            // Un solo CR seguido por el byte 0 del stream
            if (this.capturingObjStm) {
              this.appendObjStmBytesWithTail(Buffer.from([byte]));
            } else {
              this.streamTail = Buffer.from([byte]);
            }
          }
        }
        break;
      case 'IN_STREAM':
        break;
    }
  }

  private handleNormalByte(byte: number): void {
    if (isPdfWhitespace(byte)) return;
    if (byte === 0x25) {
      // %
      this.state = 'IN_COMMENT';
      return;
    }
    if (byte === 0x28) {
      // (
      this.state = 'IN_LITERAL_STRING';
      this.stringParenDepth = 1;
      this.stringEscaped = false;
      return;
    }
    if (byte === 0x29) {
      // )
      this.fail('unverifiable', 'MALFORMED_SYNTAX', 'Unmatched )');
      return;
    }
    if (byte === 0x3c) {
      // <
      this.state = 'AFTER_LT';
      return;
    }
    if (byte === 0x3e) {
      // >
      this.state = 'AFTER_GT';
      return;
    }
    if (byte === 0x5b) {
      // [
      this.openArray();
      return;
    }
    if (byte === 0x5d) {
      // ]
      this.closeArray();
      return;
    }
    if (byte === 0x2f) {
      // /
      this.tokenBytes = [];
      this.state = 'IN_NAME';
      return;
    }
    if (byte === 0x7b || byte === 0x7d) {
      // { or }
      if (this.containerStack.length > 0) {
        this.fail('unverifiable', 'MALFORMED_SYNTAX', 'Unexpected brace inside container');
      }
      return;
    }
    this.tokenBytes = [byte];
    this.state = 'IN_WORD';
  }

  private handleLiteralStringByte(byte: number): void {
    if (this.stringEscaped) {
      this.stringEscaped = false;
      return;
    }
    if (byte === 0x5c) {
      // \
      this.stringEscaped = true;
      return;
    }
    if (byte === 0x28) {
      // (
      this.stringParenDepth++;
      if (this.stringParenDepth > PDF_SCANNER_LIMITS.MAX_NESTING_DEPTH) {
        this.fail('unverifiable', 'MAX_STRING_NESTING', 'Nested parentheses exceed limit');
      }
      return;
    }
    if (byte === 0x29) {
      // )
      this.stringParenDepth--;
      if (this.stringParenDepth === 0) {
        this.state = 'NORMAL';
        this.emitValue(PDF_STRING_SENTINEL);
      }
    }
  }

  private handleHexStringByte(byte: number): void {
    if (byte === 0x3e) {
      // >
      this.state = 'NORMAL';
      this.emitValue(PDF_STRING_SENTINEL);
      return;
    }
    if (!isHexOrWs(byte)) {
      this.fail('unverifiable', 'MALFORMED_HEX_STRING', 'Invalid character inside hex string');
    }
  }

  private enterStream(): void {
    const dict = this.lastCompletedDict;
    this.lastCompletedDict = null;
    if (!dict) {
      this.fail('unverifiable', 'MALFORMED_STREAM', 'Missing stream dictionary');
      return;
    }
    this.state = 'IN_STREAM';
    this.streamTail = EMPTY_BUF;
    this.pendingEndstreamMatch = false;
    this.objStmChunks = [];
    this.objStmByteCount = 0;

    if (dictHasNameValue(dict, '/Type', '/ObjStm')) {
      if (this.capturedObjStms.length >= PDF_SCANNER_LIMITS.MAX_OBJSTM_COUNT) {
        this.fail('unverifiable', 'MAX_OBJSTM_COUNT', 'Too many /ObjStm streams');
        return;
      }
      this.capturingObjStm = true;
      this.currentObjStmDict = dict;
    } else {
      this.capturingObjStm = false;
      this.currentObjStmDict = null;
    }
  }

  private pushObjStmChunk(buf: Buffer): boolean {
    if (buf.length === 0) return true;
    this.objStmByteCount += buf.length;
    if (this.objStmByteCount > PDF_SCANNER_LIMITS.MAX_OBJSTM_COMPRESSED_BYTES) {
      this.fail('unverifiable', 'OBJSTM_TOO_LARGE', 'Single /ObjStm exceeds max compressed bytes');
      return false;
    }
    this.totalRetainedObjStmBytes += buf.length;
    if (this.totalRetainedObjStmBytes > PDF_SCANNER_LIMITS.MAX_RETAINED_OBJSTM_BYTES) {
      this.fail(
        'unverifiable',
        'MAX_RETAINED_BYTES_EXCEEDED',
        'Total retained /ObjStm bytes exceed limit'
      );
      return false;
    }
    this.objStmChunks.push(Buffer.from(buf));
    return true;
  }

  private appendObjStmBytesWithTail(buf: Buffer): void {
    const combined = this.streamTail.length > 0 ? Buffer.concat([this.streamTail, buf]) : buf;
    const keepLen = Math.min(8, combined.length);
    const flushLen = combined.length - keepLen;
    if (flushLen > 0) {
      if (!this.pushObjStmChunk(combined.subarray(0, flushLen))) return;
    }
    this.streamTail = keepLen > 0 ? Buffer.from(combined.subarray(flushLen)) : EMPTY_BUF;
  }

  private finishStream(): void {
    if (this.capturingObjStm && this.currentObjStmDict) {
      this.capturedObjStms.push({
        dict: this.currentObjStmDict,
        rawData: Buffer.concat(this.objStmChunks),
      });
    }
    this.capturingObjStm = false;
    this.currentObjStmDict = null;
    this.objStmChunks = [];
    this.objStmByteCount = 0;
    this.streamTail = EMPTY_BUF;
    this.pendingEndstreamMatch = false;
    this.lastCompletedDict = null;
    this.state = 'NORMAL';
  }

  private processStreamChunk(chunk: Buffer, startIndex: number): number {
    const slice = startIndex === 0 ? chunk : chunk.subarray(startIndex);
    if (slice.length === 0) return chunk.length;

    let searchPos = 0;
    let tailFlushed = false;

    if (this.pendingEndstreamMatch) {
      this.pendingEndstreamMatch = false;
      if (isPdfWhitespaceOrDelimiter(slice[0])) {
        this.finishStream();
        return startIndex;
      }
      if (this.capturingObjStm) {
        if (!this.pushObjStmChunk(ENDSTREAM_BUF)) return chunk.length;
      }
      this.streamTail = EMPTY_BUF;
    }

    if (this.streamTail.length > 0) {
      const tailLen = this.streamTail.length;
      const headLen = Math.min(8, slice.length);
      const boundary = Buffer.concat([this.streamTail, slice.subarray(0, headLen)]);
      const idx = boundary.indexOf(ENDSTREAM_BUF);
      if (idx !== -1 && idx < tailLen) {
        const afterPos = idx + ENDSTREAM_BUF.length - tailLen;
        if (afterPos < slice.length) {
          if (isPdfWhitespaceOrDelimiter(slice[afterPos])) {
            if (this.capturingObjStm && idx > 0) {
              if (!this.pushObjStmChunk(this.streamTail.subarray(0, idx))) return chunk.length;
            }
            this.finishStream();
            return startIndex + afterPos;
          }
          // Falsa alarma (ej. endstreamXYZ)
          if (this.capturingObjStm) {
            if (!this.pushObjStmChunk(this.streamTail)) return chunk.length;
            if (afterPos > 0 && !this.pushObjStmChunk(slice.subarray(0, afterPos))) {
              return chunk.length;
            }
          }
          this.streamTail = EMPTY_BUF;
          tailFlushed = true;
          searchPos = afterPos;
        } else {
          // Termina exactamente con 'endstream' en el límite del chunk
          if (this.capturingObjStm && idx > 0) {
            if (!this.pushObjStmChunk(this.streamTail.subarray(0, idx))) return chunk.length;
          }
          this.streamTail = EMPTY_BUF;
          this.pendingEndstreamMatch = true;
          return chunk.length;
        }
      }
    }

    let found = slice.indexOf(ENDSTREAM_BUF, searchPos);
    while (found !== -1) {
      const after = found + ENDSTREAM_BUF.length;
      if (after < slice.length) {
        if (isPdfWhitespaceOrDelimiter(slice[after])) {
          if (this.capturingObjStm) {
            if (!tailFlushed && this.streamTail.length > 0) {
              if (!this.pushObjStmChunk(this.streamTail)) return chunk.length;
            }
            if (found > searchPos) {
              if (!this.pushObjStmChunk(slice.subarray(searchPos, found))) return chunk.length;
            }
          }
          this.finishStream();
          return startIndex + after;
        }
        found = slice.indexOf(ENDSTREAM_BUF, after);
      } else {
        if (this.capturingObjStm) {
          if (!tailFlushed && this.streamTail.length > 0) {
            if (!this.pushObjStmChunk(this.streamTail)) return chunk.length;
          }
          if (found > searchPos) {
            if (!this.pushObjStmChunk(slice.subarray(searchPos, found))) return chunk.length;
          }
        }
        this.streamTail = EMPTY_BUF;
        this.pendingEndstreamMatch = true;
        return chunk.length;
      }
    }

    // No se encontró endstream en este slice: retener últimos <= 8 bytes como cola
    const tailPart = slice.subarray(searchPos);
    const combinedTail =
      !tailFlushed && this.streamTail.length > 0
        ? Buffer.concat([this.streamTail, tailPart])
        : tailPart;
    const keepLen = Math.min(8, combinedTail.length);
    const flushLen = combinedTail.length - keepLen;
    if (this.capturingObjStm && flushLen > 0) {
      if (!this.pushObjStmChunk(combinedTail.subarray(0, flushLen))) return chunk.length;
    }
    this.streamTail = keepLen > 0 ? Buffer.from(combinedTail.subarray(flushLen)) : EMPTY_BUF;
    return chunk.length;
  }

  private openDict(): void {
    if (this.containerStack.length >= PDF_SCANNER_LIMITS.MAX_NESTING_DEPTH) {
      this.fail('unverifiable', 'MAX_NESTING_DEPTH', 'Container nesting exceeds limit');
      return;
    }
    if (!this.bumpAstNodes()) return;

    const top = this.containerStack[this.containerStack.length - 1];
    if (top && top.kind === 'dict') {
      if (top.expectingKey) {
        this.fail('unverifiable', 'MALFORMED_DICT_KEY', 'Unexpected << where dict key expected');
        return;
      }
      if (!this.flushDictPendingSingleInt(top)) return;
      if (top.expectingKey) {
        this.fail('unverifiable', 'MALFORMED_DICT_KEY', 'Unexpected << after completed entry');
        return;
      }
    }

    const dict: PdfDict = {
      kind: 'dict',
      entries: new Map(),
      entryCount: 0,
    };
    this.containerStack.push({
      kind: 'dict',
      dict,
      expectingKey: true,
      currentKey: null,
      pendingNums: [],
    });
  }

  private closeDict(): void {
    const top = this.containerStack[this.containerStack.length - 1];
    if (!top || top.kind !== 'dict') {
      this.fail('unverifiable', 'UNMATCHED_DICT_CLOSE', 'Unexpected >>');
      return;
    }

    if (!top.expectingKey) {
      if (top.pendingNums.length === 1 && top.currentKey !== null) {
        const val: PdfNumberValue = {
          kind: 'number',
          value: top.pendingNums[0],
          isNonNegInt: true,
        };
        if (!addDictEntry(top.dict, top.currentKey, val)) {
          this.fail('unverifiable', 'MAX_DICT_ENTRIES', 'Dictionary entry limit exceeded');
          return;
        }
        top.pendingNums = [];
        top.currentKey = null;
        top.expectingKey = true;
      } else {
        this.fail('unverifiable', 'MISSING_DICT_VALUE', 'Dictionary key without value before >>');
        return;
      }
    }

    this.containerStack.pop();
    this.allDicts.push(top.dict);
    this.deliverCompletedContainer(top.dict);
  }

  private openArray(): void {
    if (this.containerStack.length >= PDF_SCANNER_LIMITS.MAX_NESTING_DEPTH) {
      this.fail('unverifiable', 'MAX_NESTING_DEPTH', 'Container nesting exceeds limit');
      return;
    }
    if (!this.bumpAstNodes()) return;

    const top = this.containerStack[this.containerStack.length - 1];
    if (top && top.kind === 'dict') {
      if (top.expectingKey) {
        this.fail('unverifiable', 'MALFORMED_DICT_KEY', 'Unexpected [ where dict key expected');
        return;
      }
      if (!this.flushDictPendingSingleInt(top)) return;
      if (top.expectingKey) {
        this.fail('unverifiable', 'MALFORMED_DICT_KEY', 'Unexpected [ after completed entry');
        return;
      }
    }

    this.containerStack.push({
      kind: 'array',
      items: [],
    });
  }

  private closeArray(): void {
    const top = this.containerStack[this.containerStack.length - 1];
    if (!top || top.kind !== 'array') {
      this.fail('unverifiable', 'UNMATCHED_ARRAY_CLOSE', 'Unexpected ]');
      return;
    }
    this.containerStack.pop();
    const arr: PdfArrayValue = { kind: 'array', items: top.items };
    this.deliverCompletedContainer(arr);
  }

  private deliverCompletedContainer(value: PdfDict | PdfArrayValue): void {
    if (this.containerStack.length === 0) {
      if (this.inObjStmMode) {
        this.objStmValues.push(value);
        return;
      }
      this.topPendingInts = [];
      if (this.currentObjKey !== null) {
        this.currentObjValues.push(value);
      }
      this.lastCompletedDict = value.kind === 'dict' ? value : null;
      return;
    }

    const parent = this.containerStack[this.containerStack.length - 1];
    if (parent.kind === 'array') {
      if (parent.items.length >= PDF_SCANNER_LIMITS.MAX_ARRAY_ELEMENTS) {
        this.fail('unverifiable', 'MAX_ARRAY_ELEMENTS', 'Array element limit exceeded');
        return;
      }
      parent.items.push(value);
      return;
    }

    if (parent.expectingKey || parent.currentKey === null || parent.pendingNums.length > 0) {
      this.fail('unverifiable', 'MALFORMED_DICT_VALUE', 'Unexpected container in dictionary');
      return;
    }
    if (!addDictEntry(parent.dict, parent.currentKey, value)) {
      this.fail('unverifiable', 'MAX_DICT_ENTRIES', 'Dictionary entry limit exceeded');
      return;
    }
    parent.currentKey = null;
    parent.expectingKey = true;
  }

  private flushDictPendingSingleInt(frame: DictFrame): boolean {
    if (frame.pendingNums.length === 0) return true;
    if (frame.pendingNums.length === 1 && frame.currentKey !== null) {
      const val: PdfNumberValue = {
        kind: 'number',
        value: frame.pendingNums[0],
        isNonNegInt: true,
      };
      if (!addDictEntry(frame.dict, frame.currentKey, val)) {
        this.fail('unverifiable', 'MAX_DICT_ENTRIES', 'Dictionary entry limit exceeded');
        return false;
      }
      frame.pendingNums = [];
      frame.currentKey = null;
      frame.expectingKey = true;
      return true;
    }
    this.fail('unverifiable', 'MALFORMED_DICT_VALUE', 'Invalid integer sequence in dictionary');
    return false;
  }

  private flushName(): void {
    const decoded = decodePdfName(this.tokenBytes);
    this.tokenBytes = [];
    if (decoded === null) {
      this.fail('unverifiable', 'INVALID_NAME_ESCAPE', 'Malformed # escape in PDF name');
      return;
    }
    this.emitValue({ kind: 'name', value: decoded });
  }

  private flushWord(): boolean {
    const word = Buffer.from(this.tokenBytes).toString('latin1');
    this.tokenBytes = [];
    if (word.length === 0) return false;

    if (this.containerStack.length === 0) {
      return this.handleTopLevelWord(word);
    }

    if (word === 'true') {
      this.emitValue(PDF_TRUE_VALUE);
      return false;
    }
    if (word === 'false') {
      this.emitValue(PDF_FALSE_VALUE);
      return false;
    }
    if (word === 'null') {
      this.emitValue(PDF_NULL_VALUE);
      return false;
    }

    const nonNegInt = parseNonNegInt(word);
    if (nonNegInt !== null) {
      this.emitNonNegIntInsideContainer(nonNegInt);
      return false;
    }

    const num = parsePdfNumber(word);
    if (num !== null) {
      this.emitValue({ kind: 'number', value: num });
      return false;
    }

    this.emitValue({ kind: 'word', value: word });
    return false;
  }

  private handleTopLevelWord(word: string): boolean {
    if (this.inObjStmMode) {
      if (word === 'obj' || word === 'endobj' || word === 'stream' || word === 'endstream') {
        this.fail('unverifiable', 'INVALID_OBJSTM_CONTENT', `Forbidden keyword ${word} in /ObjStm`);
        return false;
      }
      this.pushTopLevelValue(this.objStmValues, word);
      return false;
    }

    if (word === 'stream') {
      if (this.lastCompletedDict !== null) {
        this.state = 'STREAM_AFTER_KEYWORD';
        return true;
      }
      this.topPendingInts = [];
      return false;
    }

    this.lastCompletedDict = null;

    if (word === 'obj') {
      if (this.currentObjKey !== null) {
        this.fail('unverifiable', 'UNCLOSED_OBJECT', 'Nested obj before endobj');
        return false;
      }
      if (this.topPendingInts.length !== 2) {
        this.fail('unverifiable', 'MALFORMED_OBJ_HEADER', 'obj missing object/generation numbers');
        return false;
      }
      if (!this.bumpObjects()) return false;
      this.currentObjKey = `${this.topPendingInts[0]} ${this.topPendingInts[1]}`;
      this.currentObjValues = [];
      this.topPendingInts = [];
      return false;
    }

    if (word === 'endobj') {
      if (this.currentObjKey === null) {
        this.fail('unverifiable', 'UNMATCHED_ENDOBJ', 'Unexpected endobj outside object');
        return false;
      }
      const existing = this.objectVersions.get(this.currentObjKey);
      if (existing) {
        for (const v of this.currentObjValues) {
          existing.push(v);
        }
      } else {
        this.objectVersions.set(this.currentObjKey, this.currentObjValues);
      }
      this.currentObjKey = null;
      this.currentObjValues = [];
      this.topPendingInts = [];
      return false;
    }

    if (this.currentObjKey !== null) {
      this.pushTopLevelValue(this.currentObjValues, word);
      return false;
    }

    const intVal = parseNonNegInt(word);
    if (intVal !== null) {
      if (this.topPendingInts.length === 2) {
        this.topPendingInts[0] = this.topPendingInts[1];
        this.topPendingInts[1] = intVal;
      } else {
        this.topPendingInts.push(intVal);
      }
    } else {
      this.topPendingInts = [];
    }
    return false;
  }

  private pushTopLevelValue(target: PdfValue[], word: string): void {
    if (!this.bumpAstNodes()) return;

    if (word === 'R' && target.length >= 2) {
      const genVal = target[target.length - 1];
      const objVal = target[target.length - 2];
      if (
        objVal.kind === 'number' &&
        objVal.isNonNegInt &&
        genVal.kind === 'number' &&
        genVal.isNonNegInt
      ) {
        target.pop();
        target.pop();
        target.push({ kind: 'ref', obj: objVal.value, gen: genVal.value });
        return;
      }
    }

    if (word === 'true') {
      target.push(PDF_TRUE_VALUE);
    } else if (word === 'false') {
      target.push(PDF_FALSE_VALUE);
    } else if (word === 'null') {
      target.push(PDF_NULL_VALUE);
    } else {
      const nonNeg = parseNonNegInt(word);
      if (nonNeg !== null) {
        target.push({ kind: 'number', value: nonNeg, isNonNegInt: true });
      } else {
        const num = parsePdfNumber(word);
        if (num !== null) {
          target.push({ kind: 'number', value: num });
        } else {
          target.push({ kind: 'word', value: word });
        }
      }
    }
  }

  private emitNonNegIntInsideContainer(intVal: number): void {
    const top = this.containerStack[this.containerStack.length - 1];
    if (top.kind === 'dict') {
      if (top.expectingKey || top.currentKey === null) {
        this.fail('unverifiable', 'MALFORMED_DICT_KEY', 'Number where dictionary key expected');
        return;
      }
      if (top.pendingNums.length >= 2) {
        this.fail('unverifiable', 'MALFORMED_DICT_VALUE', 'Too many consecutive integers in dict');
        return;
      }
      if (!this.bumpAstNodes()) return;
      top.pendingNums.push(intVal);
      return;
    }

    if (!this.bumpAstNodes()) return;
    if (top.items.length >= PDF_SCANNER_LIMITS.MAX_ARRAY_ELEMENTS) {
      this.fail('unverifiable', 'MAX_ARRAY_ELEMENTS', 'Array element limit exceeded');
      return;
    }
    top.items.push({ kind: 'number', value: intVal, isNonNegInt: true });
  }

  private emitValue(value: PdfValue): void {
    if (this.containerStack.length === 0) {
      this.lastCompletedDict = null;
      this.topPendingInts = [];
      if (this.inObjStmMode) {
        if (!this.bumpAstNodes()) return;
        this.objStmValues.push(value);
      } else if (this.currentObjKey !== null) {
        if (!this.bumpAstNodes()) return;
        this.currentObjValues.push(value);
      }
      return;
    }

    const top = this.containerStack[this.containerStack.length - 1];
    if (top.kind === 'array') {
      if (
        value.kind === 'word' &&
        value.value === 'R' &&
        top.items.length >= 2
      ) {
        const genVal = top.items[top.items.length - 1];
        const objVal = top.items[top.items.length - 2];
        if (
          objVal.kind === 'number' &&
          objVal.isNonNegInt &&
          genVal.kind === 'number' &&
          genVal.isNonNegInt
        ) {
          top.items.pop();
          top.items.pop();
          top.items.push({ kind: 'ref', obj: objVal.value, gen: genVal.value });
          return;
        }
      }
      if (!this.bumpAstNodes()) return;
      if (top.items.length >= PDF_SCANNER_LIMITS.MAX_ARRAY_ELEMENTS) {
        this.fail('unverifiable', 'MAX_ARRAY_ELEMENTS', 'Array element limit exceeded');
        return;
      }
      top.items.push(value);
      return;
    }

    // Dict frame
    if (top.pendingNums.length > 0) {
      if (value.kind === 'word' && value.value === 'R' && top.pendingNums.length === 2) {
        if (top.currentKey === null) {
          this.fail('unverifiable', 'MALFORMED_DICT_VALUE', 'Missing key for ref');
          return;
        }
        const refVal: PdfRefValue = {
          kind: 'ref',
          obj: top.pendingNums[0],
          gen: top.pendingNums[1],
        };
        if (!addDictEntry(top.dict, top.currentKey, refVal)) {
          this.fail('unverifiable', 'MAX_DICT_ENTRIES', 'Dictionary entry limit exceeded');
          return;
        }
        top.pendingNums = [];
        top.currentKey = null;
        top.expectingKey = true;
        return;
      }
      if (!this.flushDictPendingSingleInt(top)) return;
    }

    if (top.expectingKey) {
      if (value.kind !== 'name') {
        this.fail('unverifiable', 'MALFORMED_DICT_KEY', `Expected name key, got ${value.kind}`);
        return;
      }
      top.currentKey = value.value;
      top.expectingKey = false;
      return;
    }

    if (value.kind === 'word') {
      this.fail('unverifiable', 'MALFORMED_DICT_VALUE', `Unexpected keyword ${value.value} in dict`);
      return;
    }

    if (!this.bumpAstNodes()) return;
    if (top.currentKey === null || !addDictEntry(top.dict, top.currentKey, value)) {
      this.fail('unverifiable', 'MAX_DICT_ENTRIES', 'Dictionary entry limit exceeded');
      return;
    }
    top.currentKey = null;
    top.expectingKey = true;
  }

  private detectEncrypt(): boolean {
    for (const dict of this.allDicts) {
      if (getDictNonNullValues(dict, '/Encrypt').length > 0) {
        return true;
      }
    }
    return false;
  }

  private resolveScalarInt(val: PdfValue): number | null {
    const resolved = this.resolveValues(val, new Set(), 0);
    if (resolved === null || resolved.unresolved || resolved.values.length === 0) return null;
    const first = resolved.values[0];
    if (first.kind === 'number' && Number.isInteger(first.value)) {
      return first.value;
    }
    return null;
  }

  private processObjStms(hasEncrypt: boolean): void {
    if (this.capturedObjStms.length === 0) return;

    if (hasEncrypt) {
      this.fail('protected', 'ENCRYPTED_OBJSTM', '/Encrypt+/ObjStm');
      return;
    }

    let totalInflatedBytes = 0;

    for (const stm of this.capturedObjStms) {
      if (!this.checkDeadline()) return;

      const filterCheck = this.validateObjStmFilter(stm.dict);
      if (filterCheck === 'unsupported') {
        this.fail('unverifiable', 'UNSUPPORTED_OBJSTM_FILTER', '/ObjStm unsupported filter');
        return;
      }

      let compressedSlice = stm.rawData;
      const lengthVals = getDictNonNullValues(stm.dict, '/Length');
      if (lengthVals.length > 0) {
        const declaredLen = this.resolveScalarInt(lengthVals[0]);
        if (declaredLen !== null) {
          if (declaredLen < 0 || declaredLen > stm.rawData.length) {
            this.fail('unverifiable', 'OBJSTM_LENGTH_MISMATCH', 'Invalid /ObjStm /Length');
            return;
          }
          compressedSlice = stm.rawData.subarray(0, declaredLen);
        }
      }

      let inflated: Buffer;
      if (filterCheck === 'flate') {
        try {
          inflated = zlib.inflateSync(compressedSlice, {
            maxOutputLength: PDF_SCANNER_LIMITS.MAX_OBJSTM_INFLATED_BYTES,
          });
        } catch (err) {
          const code = (err as any)?.code;
          this.fail(
            hasEncrypt ? 'protected' : 'unverifiable',
            'OBJSTM_INFLATE_FAILED',
            `zlib inflate failed (${code || 'error'})`
          );
          return;
        }
      } else {
        if (compressedSlice.length > PDF_SCANNER_LIMITS.MAX_OBJSTM_INFLATED_BYTES) {
          this.fail('unverifiable', 'OBJSTM_TOO_LARGE', 'Uncompressed /ObjStm exceeds limit');
          return;
        }
        inflated = compressedSlice;
      }

      totalInflatedBytes += inflated.length;
      if (totalInflatedBytes > PDF_SCANNER_LIMITS.MAX_OBJSTM_TOTAL_INFLATED_BYTES) {
        this.fail('unverifiable', 'MAX_OBJSTM_INFLATED_TOTAL', 'Total /ObjStm inflated limit');
        return;
      }

      this.parseInflatedObjStm(stm.dict, inflated);
      if (this.failure) return;
    }

    // Liberar buffers comprimidos una vez inflados y parseados
    this.capturedObjStms = [];
  }

  private validateObjStmFilter(dict: PdfDict): 'none' | 'flate' | 'unsupported' {
    const decodeParmsVals = getDictNonNullValues(dict, '/DecodeParms');
    for (const dp of decodeParmsVals) {
      const resolved = this.resolveValues(dp, new Set(), 0);
      if (!resolved || resolved.unresolved) return 'unsupported';
      for (const item of resolved.values) {
        const dictsToCheck: PdfValue[] =
          item.kind === 'array' ? item.items : [item];
        for (const candidate of dictsToCheck) {
          if (candidate.kind === 'null') continue;
          if (candidate.kind !== 'dict') return 'unsupported';
          const predVals = getDictNonNullValues(candidate, '/Predictor');
          for (const pv of predVals) {
            if (pv.kind !== 'number' || pv.value > 1) {
              return 'unsupported';
            }
          }
        }
      }
    }

    const filterVals = getDictNonNullValues(dict, '/Filter');
    if (filterVals.length === 0) return 'none';
    if (filterVals.length > 1) return 'unsupported';

    const fVal = filterVals[0];
    if (fVal.kind === 'name') {
      return fVal.value === '/FlateDecode' ? 'flate' : 'unsupported';
    }
    if (fVal.kind === 'array') {
      if (fVal.items.length === 0) return 'none';
      if (
        fVal.items.length === 1 &&
        fVal.items[0].kind === 'name' &&
        fVal.items[0].value === '/FlateDecode'
      ) {
        return 'flate';
      }
      return 'unsupported';
    }
    return 'unsupported';
  }

  private parseInflatedObjStm(dict: PdfDict, inflated: Buffer): void {
    const nVals = getDictNonNullValues(dict, '/N');
    const firstVals = getDictNonNullValues(dict, '/First');
    if (nVals.length !== 1 || firstVals.length !== 1) {
      this.fail('unverifiable', 'INVALID_OBJSTM_HEADER', 'Missing /N or /First in /ObjStm');
      return;
    }
    const nVal = nVals[0];
    const firstVal = firstVals[0];
    if (
      nVal.kind !== 'number' ||
      !nVal.isNonNegInt ||
      firstVal.kind !== 'number' ||
      !firstVal.isNonNegInt
    ) {
      this.fail('unverifiable', 'INVALID_OBJSTM_HEADER', 'Non-integer /N or /First in /ObjStm');
      return;
    }

    const count = nVal.value;
    const first = firstVal.value;

    if (count > PDF_SCANNER_LIMITS.MAX_OBJECTS || first > inflated.length) {
      this.fail('unverifiable', 'INVALID_OBJSTM_HEADER', '/N or /First out of bounds');
      return;
    }
    if (count === 0) return;

    const headerNums = this.parseHeaderIntegers(inflated.subarray(0, first), count * 2);
    if (!headerNums) {
      this.fail('unverifiable', 'INVALID_OBJSTM_HEADER', 'Malformed /ObjStm offset table');
      return;
    }

    const dataLen = inflated.length - first;
    const entries: Array<{ objNum: number; offset: number }> = [];
    let prevOffset = -1;

    for (let i = 0; i < count; i++) {
      const objNum = headerNums[i * 2];
      const relOffset = headerNums[i * 2 + 1];
      if (relOffset < prevOffset || relOffset >= dataLen) {
        this.fail('unverifiable', 'INVALID_OBJSTM_HEADER', 'Invalid offset order or bounds');
        return;
      }
      prevOffset = relOffset;
      entries.push({ objNum, offset: relOffset });
    }

    for (let i = 0; i < entries.length; i++) {
      if (!this.bumpObjects()) return;
      if (!this.checkDeadline()) return;

      const start = first + entries[i].offset;
      const end = i + 1 < entries.length ? first + entries[i + 1].offset : inflated.length;
      const objSlice = inflated.subarray(start, end);
      const parsedVals = this.parseSingleObjStmSlice(objSlice);
      if (this.failure) return;

      const key = `${entries[i].objNum} 0`;
      const existing = this.objectVersions.get(key);
      if (existing) {
        for (const v of parsedVals) existing.push(v);
      } else {
        this.objectVersions.set(key, parsedVals);
      }
    }
  }

  private parseHeaderIntegers(headerBuf: Buffer, expectedCount: number): number[] | null {
    const nums: number[] = [];
    let current = '';
    for (let i = 0; i < headerBuf.length; i++) {
      const b = headerBuf[i];
      if (isPdfWhitespace(b)) {
        if (current.length > 0) {
          const parsed = parseNonNegInt(current);
          if (parsed === null) return null;
          nums.push(parsed);
          current = '';
          if (nums.length > expectedCount) return null;
        }
      } else if (b >= 0x30 && b <= 0x39) {
        current += String.fromCharCode(b);
        if (current.length > 16) return null;
      } else {
        return null;
      }
    }
    if (current.length > 0) {
      const parsed = parseNonNegInt(current);
      if (parsed === null) return null;
      nums.push(parsed);
    }
    return nums.length === expectedCount ? nums : null;
  }

  private getLexerState(): LexerState {
    return this.state;
  }

  private parseSingleObjStmSlice(slice: Buffer): PdfValue[] {
    this.inObjStmMode = true;
    this.objStmValues = [];
    this.state = 'NORMAL';
    this.tokenBytes = [];
    this.containerStack = [];
    this.topPendingInts = [];

    for (let i = 0; i < slice.length && !this.failure; i++) {
      this.processByte(slice[i]);
    }

    if (!this.failure) {
      const currentState = this.getLexerState();
      if (currentState === 'IN_WORD') {
        this.state = 'NORMAL';
        this.flushWord();
      } else if (currentState === 'IN_NAME') {
        this.state = 'NORMAL';
        this.flushName();
      } else if (currentState === 'IN_COMMENT') {
        this.state = 'NORMAL';
      }
    }

    if (!this.failure && (this.getLexerState() !== 'NORMAL' || this.containerStack.length > 0)) {
      this.fail('unverifiable', 'TRUNCATED_OBJSTM_OBJECT', 'Truncated object inside /ObjStm');
    }

    const result = this.objStmValues;
    this.inObjStmMode = false;
    this.objStmValues = [];
    return result;
  }

  private resolveValues(
    val: PdfValue,
    visitedRefs: Set<string>,
    depth: number
  ): { values: PdfValue[]; unresolved: boolean } | null {
    if (depth > PDF_SCANNER_LIMITS.MAX_REFERENCE_DEPTH) {
      this.fail('unverifiable', 'MAX_REFERENCE_DEPTH', 'Indirect reference chain too deep');
      return null;
    }

    if (val.kind !== 'ref') {
      return { values: [val], unresolved: false };
    }

    const refKey = `${val.obj} ${val.gen}`;
    if (visitedRefs.has(refKey)) {
      this.fail('unverifiable', 'CIRCULAR_REFERENCE', `Circular ref ${refKey}`);
      return null;
    }

    const targets = this.objectVersions.get(refKey);
    if (!targets || targets.length === 0) {
      return { values: [], unresolved: true };
    }

    visitedRefs.add(refKey);
    const out: PdfValue[] = [];
    let unresolved = false;
    try {
      for (const target of targets) {
        const sub = this.resolveValues(target, visitedRefs, depth + 1);
        if (!sub) return null;
        if (sub.unresolved) unresolved = true;
        for (const item of sub.values) {
          out.push(item);
        }
      }
    } finally {
      visitedRefs.delete(refKey);
    }
    return { values: out, unresolved };
  }

  private hasJsAction(dict: PdfDict): boolean {
    if (dictHasNameValue(dict, '/S', '/JavaScript')) return true;
    return getDictNonNullValues(dict, '/JS').length > 0;
  }

  private hasForbiddenContainerType(dict: PdfDict): boolean {
    for (const tv of getDictNonNullValues(dict, '/Type')) {
      if (tv.kind === 'name' && DISALLOWED_FORM_CONTAINER_TYPES.has(tv.value)) {
        return true;
      }
    }
    return false;
  }

  private isFormFieldDict(dict: PdfDict): boolean {
    if (this.hasForbiddenContainerType(dict)) return false;

    for (const ft of getDictNonNullValues(dict, '/FT')) {
      if (ft.kind === 'name' && VALID_FORM_FT.has(ft.value)) {
        return !this.hasForbiddenAncestor(dict);
      }
    }

    if (dictHasNameValue(dict, '/Subtype', '/Widget')) {
      return !this.hasForbiddenAncestor(dict);
    }

    // Verificar herencia de /FT por /Parent
    let current: PdfDict = dict;
    const seen = new Set<PdfDict>([current]);
    for (let hop = 0; hop < 5; hop++) {
      const parentVals = getDictNonNullValues(current, '/Parent');
      if (parentVals.length !== 1) break;
      const resolved = this.resolveValues(parentVals[0], new Set(), 0);
      if (!resolved || resolved.unresolved || resolved.values.length !== 1) break;
      const parent = resolved.values[0];
      if (parent.kind !== 'dict' || seen.has(parent)) break;
      seen.add(parent);
      if (this.hasForbiddenContainerType(parent)) return false;
      for (const ft of getDictNonNullValues(parent, '/FT')) {
        if (ft.kind === 'name' && VALID_FORM_FT.has(ft.value)) {
          return true;
        }
      }
      current = parent;
    }

    return false;
  }

  private hasForbiddenAncestor(dict: PdfDict): boolean {
    let current: PdfDict = dict;
    const seen = new Set<PdfDict>([current]);
    for (let hop = 0; hop < 5; hop++) {
      const parentVals = getDictNonNullValues(current, '/Parent');
      if (parentVals.length !== 1) break;
      const resolved = this.resolveValues(parentVals[0], new Set(), 0);
      if (!resolved || resolved.unresolved || resolved.values.length !== 1) break;
      const parent = resolved.values[0];
      if (parent.kind !== 'dict' || seen.has(parent)) break;
      seen.add(parent);
      if (this.hasForbiddenContainerType(parent)) return true;
      current = parent;
    }
    return false;
  }

  private evaluatePolicy(): void {
    // 1. Bloqueos incondicionales en cualquier diccionario del documento
    for (const dict of this.allDicts) {
      if (!this.checkDeadline()) return;

      for (const sVal of getDictNonNullValues(dict, '/S')) {
        if (sVal.kind === 'name' && ALWAYS_FORBIDDEN_ACTION_TYPES.has(sVal.value)) {
          this.fail('dangerous', 'FORBIDDEN_ACTION', sVal.value);
          return;
        }
      }

      for (const key of ALWAYS_FORBIDDEN_DICT_KEYS) {
        if (getDictNonNullValues(dict, key).length > 0) {
          this.fail('dangerous', 'FORBIDDEN_ACTION_KEY', key);
          return;
        }
      }

      if (
        dictHasNameValue(dict, '/Type', '/EmbeddedFile') ||
        dictHasNameValue(dict, '/S', '/EmbeddedFile') ||
        dictHasNameValue(dict, '/Subtype', '/FileAttachment') ||
        getDictNonNullValues(dict, '/EmbeddedFiles').length > 0 ||
        getDictNonNullValues(dict, '/EF').length > 0
      ) {
        this.fail('dangerous', 'EMBEDDED_FILE', '/EmbeddedFile');
        return;
      }

      if (dictHasNameValue(dict, '/Subtype', '/RichMedia')) {
        this.fail('dangerous', 'RICH_MEDIA', '/RichMedia');
        return;
      }
    }

    // 2. /Names << /JavaScript ... >> y /Names << /EmbeddedFiles ... >>
    for (const dict of this.allDicts) {
      for (const namesVal of getDictNonNullValues(dict, '/Names')) {
        const resolved = this.resolveValues(namesVal, new Set(), 0);
        if (!resolved) return;
        if (resolved.unresolved) {
          this.fail('unverifiable', 'UNRESOLVED_NAMES', '/Names(unresolved)');
          return;
        }
        for (const item of resolved.values) {
          if (item.kind === 'dict') {
            if (getDictNonNullValues(item, '/JavaScript').length > 0) {
              this.fail('dangerous', 'NAMES_JAVASCRIPT', '/Names->/JavaScript');
              return;
            }
            if (getDictNonNullValues(item, '/EmbeddedFiles').length > 0) {
              this.fail('dangerous', 'NAMES_EMBEDDED_FILES', '/Names->/EmbeddedFiles');
              return;
            }
          }
        }
      }
    }

    // 3. /OpenAction (solo permite destinos de navegación GoTo o [página /Fit] / nombre / string)
    for (const dict of this.allDicts) {
      for (const oaVal of getDictNonNullValues(dict, '/OpenAction')) {
        this.validateOpenAction(oaVal);
        if (this.failure) return;
      }
    }

    // 4. Acción /A (botones / links): nunca permite JS
    for (const dict of this.allDicts) {
      for (const aVal of getDictNonNullValues(dict, '/A')) {
        this.validateActionA(aVal, new Set(), new Set(), 0);
        if (this.failure) return;
      }
    }

    // 5. /AA (Additional Actions): JS permitido SOLO en /FT o /Widget con triggers /C, /F, /K, /V
    const allowedFormJsDicts = new Set<PdfDict>();
    for (const owner of this.allDicts) {
      const aaVals = getDictNonNullValues(owner, '/AA');
      if (aaVals.length === 0) continue;

      const isField = this.isFormFieldDict(owner);
      for (const aaVal of aaVals) {
        const resolved = this.resolveValues(aaVal, new Set(), 0);
        if (!resolved) return;
        if (resolved.unresolved) {
          this.fail('unverifiable', 'UNRESOLVED_AA', '/AA(unresolved)');
          return;
        }
        for (const aaObj of resolved.values) {
          if (aaObj.kind === 'null') continue;
          if (aaObj.kind !== 'dict') {
            this.fail('unverifiable', 'INVALID_AA', '/AA(non-dict)');
            return;
          }
          for (const [triggerKey, actionVal] of dictAllEntries(aaObj)) {
            if (actionVal.kind === 'null') continue;
            const allowJs = isField && SAFE_FORM_AA_TRIGGERS.has(triggerKey);
            this.validateAaAction(
              actionVal,
              triggerKey,
              allowJs,
              allowedFormJsDicts,
              new Set(),
              new Set(),
              0
            );
            if (this.failure) return;
          }
        }
      }
    }

    // 6. Barrido final fail-closed: cualquier diccionario JS fuera de campos autorizados se rechaza
    for (const dict of this.allDicts) {
      if (this.hasJsAction(dict) && !allowedFormJsDicts.has(dict)) {
        this.fail('dangerous', 'UNAUTHORIZED_JAVASCRIPT', '/JavaScript');
        return;
      }
    }
  }

  private validateOpenAction(oaVal: PdfValue): void {
    const resolved = this.resolveValues(oaVal, new Set(), 0);
    if (!resolved) return;
    if (resolved.unresolved) {
      this.fail('unverifiable', 'UNRESOLVED_OPENACTION', '/OpenAction(unresolved)');
      return;
    }

    for (const target of resolved.values) {
      if (target.kind === 'null' || target.kind === 'string') continue;

      if (target.kind === 'name') {
        if (DANGEROUS_NAMED_DESTINATIONS.has(target.value)) {
          this.fail('dangerous', 'OPENACTION_DISALLOWED_ACTION', `/OpenAction->${target.value}`);
          return;
        }
        continue;
      }

      if (target.kind === 'array') {
        for (const item of target.items) {
          if (item.kind === 'dict') {
            this.fail('dangerous', 'OPENACTION_DISALLOWED_ACTION', '/OpenAction([dict])');
            return;
          }
        }
        continue;
      }

      if (target.kind === 'dict') {
        this.validateOpenActionDictChain(target, new Set(), new Set(), 0);
        if (this.failure) return;
        continue;
      }

      this.fail('unverifiable', 'INVALID_OPENACTION', `/OpenAction(${target.kind})`);
      return;
    }
  }

  private validateOpenActionDictChain(
    val: PdfValue,
    visitedRefs: Set<string>,
    visitedDicts: Set<PdfDict>,
    depth: number
  ): void {
    if (depth > PDF_SCANNER_LIMITS.MAX_REFERENCE_DEPTH) {
      this.fail('unverifiable', 'MAX_REFERENCE_DEPTH', '/OpenAction(/Next) too deep');
      return;
    }

    const resolved = this.resolveValues(val, visitedRefs, depth);
    if (!resolved) return;
    if (resolved.unresolved) {
      this.fail('unverifiable', 'UNRESOLVED_OPENACTION_NEXT', '/OpenAction->/Next(unresolved)');
      return;
    }

    for (const item of resolved.values) {
      if (item.kind === 'null') continue;
      if (item.kind === 'array') {
        for (const el of item.items) {
          this.validateOpenActionDictChain(el, visitedRefs, visitedDicts, depth + 1);
          if (this.failure) return;
        }
        continue;
      }
      if (item.kind !== 'dict') {
        this.fail('unverifiable', 'INVALID_OPENACTION', '/OpenAction(non-dict action)');
        return;
      }
      if (visitedDicts.has(item)) {
        this.fail('unverifiable', 'CIRCULAR_ACTION', '/OpenAction(cycle)');
        return;
      }

      if (this.hasJsAction(item)) {
        this.fail('dangerous', 'OPENACTION_JAVASCRIPT', '/OpenAction->/JavaScript');
        return;
      }
      if (getDictNonNullValues(item, '/URI').length > 0) {
        this.fail('dangerous', 'OPENACTION_URI', '/OpenAction->/URI');
        return;
      }

      const sVals = getDictNonNullValues(item, '/S');
      if (sVals.length === 0) {
        this.fail('unverifiable', 'OPENACTION_MISSING_TYPE', '/OpenAction(missing /S)');
        return;
      }
      for (const sv of sVals) {
        if (sv.kind !== 'name' || sv.value !== '/GoTo') {
          const detail = sv.kind === 'name' ? sv.value : sv.kind;
          this.fail('dangerous', 'OPENACTION_DISALLOWED_ACTION', `/OpenAction->${detail}`);
          return;
        }
      }

      visitedDicts.add(item);
      try {
        for (const nextVal of getDictNonNullValues(item, '/Next')) {
          this.validateOpenActionDictChain(nextVal, visitedRefs, visitedDicts, depth + 1);
          if (this.failure) return;
        }
      } finally {
        visitedDicts.delete(item);
      }
    }
  }

  private validateActionA(
    val: PdfValue,
    visitedRefs: Set<string>,
    visitedDicts: Set<PdfDict>,
    depth: number
  ): void {
    if (depth > PDF_SCANNER_LIMITS.MAX_REFERENCE_DEPTH) {
      this.fail('unverifiable', 'MAX_REFERENCE_DEPTH', '/A chain too deep');
      return;
    }

    const resolved = this.resolveValues(val, visitedRefs, depth);
    if (!resolved) return;
    if (resolved.unresolved) {
      this.fail('unverifiable', 'UNRESOLVED_ACTION_A', '/A(unresolved)');
      return;
    }

    for (const item of resolved.values) {
      if (item.kind === 'null') continue;
      if (item.kind === 'array') {
        for (const el of item.items) {
          this.validateActionA(el, visitedRefs, visitedDicts, depth + 1);
          if (this.failure) return;
        }
        continue;
      }
      if (item.kind !== 'dict') continue;

      if (visitedDicts.has(item)) {
        this.fail('unverifiable', 'CIRCULAR_ACTION', '/A(cycle)');
        return;
      }

      if (this.hasJsAction(item)) {
        this.fail('dangerous', 'ACTION_A_JAVASCRIPT', '/A->/JavaScript');
        return;
      }

      visitedDicts.add(item);
      try {
        for (const nextVal of getDictNonNullValues(item, '/Next')) {
          this.validateActionA(nextVal, visitedRefs, visitedDicts, depth + 1);
          if (this.failure) return;
        }
      } finally {
        visitedDicts.delete(item);
      }
    }
  }

  private validateAaAction(
    val: PdfValue,
    triggerKey: string,
    allowJs: boolean,
    allowedFormJsDicts: Set<PdfDict>,
    visitedRefs: Set<string>,
    visitedDicts: Set<PdfDict>,
    depth: number
  ): void {
    if (depth > PDF_SCANNER_LIMITS.MAX_REFERENCE_DEPTH) {
      this.fail('unverifiable', 'MAX_REFERENCE_DEPTH', `/AA(${triggerKey}) too deep`);
      return;
    }

    const resolved = this.resolveValues(val, visitedRefs, depth);
    if (!resolved) return;
    if (resolved.unresolved) {
      this.fail('unverifiable', 'UNRESOLVED_AA_ACTION', `/AA(${triggerKey})(unresolved)`);
      return;
    }

    for (const item of resolved.values) {
      if (item.kind === 'null') continue;
      if (item.kind === 'array') {
        for (const el of item.items) {
          this.validateAaAction(
            el,
            triggerKey,
            allowJs,
            allowedFormJsDicts,
            visitedRefs,
            visitedDicts,
            depth + 1
          );
          if (this.failure) return;
        }
        continue;
      }
      if (item.kind !== 'dict') {
        this.fail('unverifiable', 'INVALID_AA_ACTION', `/AA(${triggerKey})(non-dict)`);
        return;
      }
      if (visitedDicts.has(item)) {
        this.fail('unverifiable', 'CIRCULAR_ACTION', `/AA(${triggerKey})(cycle)`);
        return;
      }

      if (getDictNonNullValues(item, '/URI').length > 0) {
        this.fail('dangerous', 'AA_URI', `/AA(${triggerKey})->/URI`);
        return;
      }
      for (const sv of getDictNonNullValues(item, '/S')) {
        if (sv.kind === 'name' && AA_FORBIDDEN_ACTION_TYPES.has(sv.value)) {
          this.fail('dangerous', 'AA_FORBIDDEN_ACTION', `/AA(${triggerKey})->${sv.value}`);
          return;
        }
      }

      if (this.hasJsAction(item)) {
        if (!allowJs) {
          this.fail('dangerous', 'AA_JAVASCRIPT', `/AA(${triggerKey})->/JavaScript`);
          return;
        }
        allowedFormJsDicts.add(item);
      }

      visitedDicts.add(item);
      try {
        for (const nextVal of getDictNonNullValues(item, '/Next')) {
          this.validateAaAction(
            nextVal,
            triggerKey,
            allowJs,
            allowedFormJsDicts,
            visitedRefs,
            visitedDicts,
            depth + 1
          );
          if (this.failure) return;
        }
      } finally {
        visitedDicts.delete(item);
      }
    }
  }
}

/**
 * Helper síncrono conveniente para analizar un Buffer PDF completo.
 * Nunca lanza excepciones hacia afuera (fail-closed).
 */
export function scanPdfBuffer(buffer: Buffer): PdfScanResult {
  const scanner = new PdfSecurityScanner();
  scanner.feed(buffer);
  return scanner.finish();
}
