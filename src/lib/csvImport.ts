export const UNIFIED_CSV_COLUMNS = [
  'title', 'publisher', 'subject', 'grade', 'semester', 'series',
  'curriculum_revision', 'thumbnail_url', 'description', 'book_url',
  'link_title', 'url', 'source_name', 'link_type'
] as const;

export type CsvRow = { rowNumber: number; values: Record<string, string> };

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const input = text.replace(/^\uFEFF/, '');
  const records: Array<{ rowNumber: number; cells: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowNumber = 1;

  const pushRecord = () => {
    fields.push(field);
    if (fields.some(value => value.trim() !== '')) records.push({ rowNumber, cells: fields });
    fields = [];
    field = '';
    afterQuote = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && input[index + 1] === '\n') index += 1;
        field += '\n';
        line += 1;
      } else field += character;
      continue;
    }

    if (afterQuote) {
      if (character === ',' ) {
        fields.push(field);
        field = '';
        afterQuote = false;
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && input[index + 1] === '\n') index += 1;
        pushRecord();
        line += 1;
        rowNumber = line;
      } else if (character !== ' ' && character !== '\t') {
        throw new Error(`CSV ${line}행: 따옴표 뒤에 쉼표나 줄바꿈이 필요합니다.`);
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) throw new Error(`CSV ${line}행: 따옴표는 셀의 첫 글자여야 합니다.`);
      quoted = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      pushRecord();
      line += 1;
      rowNumber = line;
    } else field += character;
  }

  if (quoted) throw new Error(`CSV ${rowNumber}행: 닫히지 않은 큰따옴표가 있습니다.`);
  if (fields.length || field.length || afterQuote) pushRecord();
  if (!records.length) throw new Error('CSV 파일에 헤더와 데이터가 없습니다.');

  const headers = records[0].cells.map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim());
  if (headers.some(header => !header)) throw new Error('CSV 헤더에 빈 컬럼명이 있습니다.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV 헤더에 중복된 컬럼명이 있습니다.');

  const rows = records.slice(1).map(record => {
    if (record.cells.length !== headers.length) {
      throw new Error(`CSV ${record.rowNumber}행: 컬럼 수가 헤더(${headers.length}개)와 다릅니다.`);
    }
    return {
      rowNumber: record.rowNumber,
      values: Object.fromEntries(headers.map((header, index) => [header, record.cells[index].trim()]))
    };
  });
  return { headers, rows };
}

export function normalizeCatalogText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function normalizeCurriculumRevision(value: string): '2015 개정' | '2022 개정' | '' | null {
  const normalized = value.replace(/\s+/g, '').toLocaleLowerCase();
  if (!normalized) return '';
  if (normalized === '2015' || normalized === '2015개정') return '2015 개정';
  if (normalized === '2022' || normalized === '2022개정') return '2022 개정';
  return null;
}

export function normalizeGrade(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, '');
  if (normalized === '전학년') return '전학년';
  if (/^(초등|중|고)?[1-6]$/.test(normalized)) return normalized;
  return null;
}

export function normalizeSemester(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, '');
  if (normalized === '공통') return normalized;
  const match = normalized.match(/^([12])(학기)?$/);
  return match ? `${match[1]}학기` : null;
}

export type BookDuplicateValues = {
  title: string;
  publisher: string;
  subject: string;
  grade: string;
  semester: string;
  series: string;
};

/** Returns an identity only when required fields and at least one optional discriminator are present. */
export function getBookDuplicateKey(values: BookDuplicateValues): string | null {
  const title = normalizeCatalogText(values.title);
  const publisher = normalizeCatalogText(values.publisher);
  const subject = normalizeCatalogText(values.subject);
  const grade = normalizeCatalogText(normalizeGrade(values.grade) ?? values.grade);
  const semester = normalizeCatalogText(normalizeSemester(values.semester) ?? values.semester);
  const series = normalizeCatalogText(values.series);

  if (!title || !publisher || !subject || !grade || (!semester && !series)) return null;
  return JSON.stringify([title, publisher, subject, grade, semester, series]);
}

export function compareBookDuplicateValues(left: BookDuplicateValues, right: BookDuplicateValues): 'match' | 'ambiguous' | 'different' {
  const normalize = (value: string) => normalizeCatalogText(value);
  const leftRequired = [left.title, left.publisher, left.subject, normalizeGrade(left.grade) ?? left.grade].map(normalize);
  const rightRequired = [right.title, right.publisher, right.subject, normalizeGrade(right.grade) ?? right.grade].map(normalize);
  if (leftRequired.some((value, index) => !value || value !== rightRequired[index])) return 'different';

  const leftOptional = [normalizeSemester(left.semester) ?? left.semester, left.series].map(normalize);
  const rightOptional = [normalizeSemester(right.semester) ?? right.semester, right.series].map(normalize);
  if (leftOptional.some((value, index) => value && rightOptional[index] && value !== rightOptional[index])) return 'different';
  if (leftOptional.some((value, index) => Boolean(value) !== Boolean(rightOptional[index]))) return 'ambiguous';
  if (!leftOptional.some(Boolean)) return 'ambiguous';
  return 'match';
}

export function validateHttpsUrl(value: string, label: string, optional = false): string | null {
  if (!value && optional) return null;
  if (!value) return `${label}을 입력해 주세요.`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return `${label}은 HTTPS 주소여야 합니다.`;
    if (!url.hostname || url.username || url.password) return `${label} 형식이 올바르지 않습니다.`;
    if (url.hostname === 'example.com' || url.hostname.endsWith('.example.com') || url.hostname.endsWith('.example')) {
      return `${label}에 샘플용 도메인은 사용할 수 없습니다.`;
    }
  } catch {
    return `${label} 형식이 올바른 URL이 아닙니다.`;
  }
  return null;
}

export function normalizeUrlForDuplicateCheck(value: string): string {
  const trimmed = value.trim();
  return trimmed ? new URL(trimmed).href : '';
}

export function areSameAnswerLinkUrl(left: string, right: string): boolean {
  const leftUrl = left.trim();
  const rightUrl = right.trim();
  if (!leftUrl || !rightUrl) return false;
  try {
    return normalizeUrlForDuplicateCheck(leftUrl) === normalizeUrlForDuplicateCheck(rightUrl);
  } catch {
    return false;
  }
}
