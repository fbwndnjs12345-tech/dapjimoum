import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, LoaderCircle, Upload, XCircle } from 'lucide-react';
import { renderAdminLayout } from './admin';
import type { AnswerLink, Book } from '../../types/book';
import {
  UNIFIED_CSV_COLUMNS,
  areSameAnswerLinkUrl,
  normalizeCatalogText,
  compareBookDuplicateValues,
  normalizeCurriculumRevision,
  normalizeGrade,
  normalizeSemester,
  normalizeUrlForDuplicateCheck,
  parseCsv,
  validateHttpsUrl,
  type CsvRow
} from '../../lib/csvImport';

const hasSupabaseConfig = () => Boolean(
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL && import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 500;

type RowIssue = { field: string; message: string };
type DuplicateReason = { type: 'url' | 'book'; message: string };
type ImportRow = CsvRow & { id: number; errors: RowIssue[]; warnings: string[]; duplicateReasons: DuplicateReason[]; outcome?: string };
type ImportSummary = { booksCreated: number; booksReused: number; linksCreated: number; skipped: number; failed: number; failures: string[] };
type ImportData = { rows: ImportRow[]; originalRows: ImportRow[]; fileName: string };
type DuplicateSnapshot = { books: Book[]; links: Array<Pick<AnswerLink, 'id' | 'book_id' | 'url'>> };

function getBookKey(values: { title: string; publisher: string; subject: string; grade: string; semester: string; series: string }) {
  return JSON.stringify([
    values.title, values.publisher, values.subject,
    normalizeGrade(values.grade) ?? values.grade,
    normalizeSemester(values.semester) ?? values.semester,
    values.series
  ].map(normalizeCatalogText));
}

function getBookKeyFromRecord(book: Book) {
  return getBookKey({
    title: book.title,
    publisher: book.publisher ?? '',
    subject: book.subject ?? '',
    grade: book.grade ?? '',
    semester: book.semester ?? '',
    series: book.series ?? ''
  });
}

function getBookDuplicateValuesFromRecord(book: Book) {
  return {
    title: book.title,
    publisher: book.publisher ?? '',
    subject: book.subject ?? '',
    grade: book.grade ?? '',
    semester: book.semester ?? '',
    series: book.series ?? ''
  };
}

function validateRow(values: Record<string, string>): RowIssue[] {
  const errors: RowIssue[] = [];
  const addError = (field: string, message: string) => errors.push({ field, message });
  for (const field of ['title', 'publisher', 'subject', 'grade', 'semester']) {
    if (!values[field]?.trim()) addError(field, `${field} 필수값을 입력해 주세요.`);
  }

  if (values.grade && !normalizeGrade(values.grade)) addError('grade', 'grade는 전학년, 중1·고1·초등1 또는 1~6 형식이어야 합니다.');
  if (values.semester && !normalizeSemester(values.semester)) addError('semester', 'semester는 1학기, 2학기 또는 공통이어야 합니다.');
  if (values.curriculum_revision && normalizeCurriculumRevision(values.curriculum_revision) === null) {
    addError('curriculum_revision', 'curriculum_revision은 2015 개정 또는 2022 개정이어야 합니다.');
  }

  for (const field of ['thumbnail_url', 'book_url']) {
    const error = validateHttpsUrl(values[field] ?? '', field, true);
    if (error) addError(field, error);
  }

  if (values.url?.trim()) {
    if (!values.link_title?.trim()) addError('link_title', '답지 URL이 있으면 link_title을 입력해 주세요.');
    const error = validateHttpsUrl(values.url, 'url');
    if (error) addError('url', error);
  }

  for (const [field, value] of Object.entries(values)) {
    const maxLength = field === 'description' ? 5000 : 500;
    if (value.length > maxLength) addError(field, `${field} 값은 ${maxLength.toLocaleString()}자 이하여야 합니다.`);
    if (/^[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) addError(field, `${field} 값에 사용할 수 없는 제어 문자가 있습니다.`);
    if (/^[=+\-@\t]/.test(value)) addError(field, `${field} 값이 스프레드시트 수식으로 해석될 수 있어 등록할 수 없습니다.`);
  }
  return errors.filter((issue, index) => errors.findIndex(candidate => candidate.field === issue.field && candidate.message === issue.message) === index);
}

function downloadTemplate() {
  const blob = new Blob([`\uFEFF${UNIFIED_CSV_COLUMNS.join(',')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '답지모음_통합_CSV_빈양식.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function addDuplicateWarnings(rows: ImportRow[], books: Book[], links: Array<Pick<AnswerLink, 'id' | 'book_id' | 'url'>>) {
  const seenBooks: Array<{ values: ReturnType<typeof getBookDuplicateValuesFromRecord>; rowNumber: number }> = [];
  const seenUrls = new Map<string, number>();
  return rows.map(row => {
    const warnings = [...row.warnings];
    const errors = [...row.errors];
    const duplicateReasons = [...row.duplicateReasons];
    const titleFields = {
      title: row.values.title,
      publisher: row.values.publisher,
      subject: row.values.subject,
      grade: row.values.grade,
      semester: row.values.semester,
      series: row.values.series
    };
    const url = row.values.url.trim();

    if (url && !validateHttpsUrl(url, 'url')) {
      const normalizedUrl = normalizeUrlForDuplicateCheck(url);
      if (links.some(link => areSameAnswerLinkUrl(link.url, url))) duplicateReasons.push({ type: 'url', message: 'URL 일치: 이미 등록된 답지 링크' });
      const firstUrlRow = seenUrls.get(normalizedUrl);
      if (firstUrlRow) duplicateReasons.push({ type: 'url', message: `URL 일치: CSV ${firstUrlRow}행과 같은 답지 링크` });
      else seenUrls.set(normalizedUrl, row.rowNumber);
    } else if (!url) {
      const databaseMatches = books.map(book => ({ book, result: compareBookDuplicateValues(titleFields, getBookDuplicateValuesFromRecord(book)) }));
      const definiteDatabaseMatches = databaseMatches.filter(match => match.result === 'match');
      const ambiguousDatabaseMatches = databaseMatches.filter(match => match.result === 'ambiguous');
      if (definiteDatabaseMatches.length) duplicateReasons.push({ type: 'book', message: '교재 정보 일치: DB의 title·publisher·subject·grade 및 입력된 semester·series 값' });
      if (definiteDatabaseMatches.length > 1) errors.push({ field: 'title', message: '교재 정보가 일치하는 DB 레코드가 여러 개라 자동 처리할 수 없습니다.' });
      if (ambiguousDatabaseMatches.length && !definiteDatabaseMatches.length) {
        errors.push({ field: 'semester', message: '중복 후보: 학기 또는 시리즈 정보가 비어 있어 기존 교재와 구분할 수 없습니다. 정보를 보완하거나 해당 행을 삭제해 주세요.' });
      }
      for (const previous of seenBooks) {
        const result = compareBookDuplicateValues(titleFields, previous.values);
        if (result === 'match') duplicateReasons.push({ type: 'book', message: `교재 정보 일치: CSV ${previous.rowNumber}행과 같은 교재` });
        else if (result === 'ambiguous') errors.push({ field: 'semester', message: `중복 후보: CSV ${previous.rowNumber}행과 기본 정보가 같지만 학기·시리즈가 부족해 중복 여부를 확정할 수 없습니다.` });
      }
      seenBooks.push({ values: titleFields, rowNumber: row.rowNumber });
      warnings.push('답지 URL이 비어 있어 교재만 등록합니다.');
    }
    return {
      ...row,
      errors: errors.filter((issue, index) => errors.findIndex(candidate => candidate.field === issue.field && candidate.message === issue.message) === index),
      warnings: [...new Set(warnings)],
      duplicateReasons: duplicateReasons.filter((reason, index) => duplicateReasons.findIndex(candidate => candidate.type === reason.type && candidate.message === reason.message) === index)
    };
  });
}

export function AdminCsvImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextRowId = useRef(1);
  const [data, setData] = useState<ImportData | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<number[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [fileError, setFileError] = useState('');
  const [duplicateError, setDuplicateError] = useState('');
  const [duplicateSnapshot, setDuplicateSnapshot] = useState<DuplicateSnapshot | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const chooseFile = async (file?: File) => {
    if (file && data && !window.confirm('현재 미리보기 내용이 사라집니다. 선택한 CSV를 업로드할까요?')) return;
    setFileError('');
    setDuplicateError('');
    setSummary(null);
    setData(null);
    setDuplicateSnapshot(null);
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith('.csv')) return setFileError('CSV 파일만 업로드할 수 있습니다.');
    if (file.size > MAX_FILE_BYTES) return setFileError('파일 크기는 2MB 이하여야 합니다.');

    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const parsed = parseCsv(text);
      if (parsed.headers.length !== UNIFIED_CSV_COLUMNS.length || !UNIFIED_CSV_COLUMNS.every((column, index) => parsed.headers[index] === column)) {
        throw new Error('통합 CSV 컬럼 형식과 다릅니다. 화면의 안내 또는 통합 CSV 빈 양식을 확인해 주세요.');
      }
      if (parsed.rows.length === 0) throw new Error('데이터 행이 없습니다. 헤더 아래에 교재 정보를 추가해 주세요.');
      if (parsed.rows.length > MAX_ROWS) throw new Error(`한 번에 최대 ${MAX_ROWS}행까지 등록할 수 있습니다.`);

      let rows: ImportRow[] = parsed.rows.map(row => ({ id: nextRowId.current++, ...row, errors: validateRow(row.values), warnings: [], duplicateReasons: [] }));
      setCheckingDuplicates(true);
      if (!hasSupabaseConfig()) {
        setDuplicateError('Supabase 환경 변수를 확인할 수 없어 기존 데이터와 중복을 비교하지 못했습니다. 등록은 비활성화됩니다.');
      } else {
        try {
          const [{ getBooks }, { getAnswerLinksForImport }] = await Promise.all([
            import('../../lib/supabase/books'),
            import('../../lib/supabase/answerLinks')
          ]);
          const [books, links] = await Promise.all([getBooks(), getAnswerLinksForImport()]);
          setDuplicateSnapshot({ books, links });
          rows = addDuplicateWarnings(rows, books, links);
        } catch (error) {
          setDuplicateError(error instanceof Error ? `기존 데이터와 비교하지 못했습니다: ${error.message}` : '기존 데이터와 비교하지 못했습니다.');
        }
      }
      setData({ fileName: file.name, rows, originalRows: rows.map(row => ({ ...row, values: { ...row.values }, errors: [...row.errors], warnings: [...row.warnings], duplicateReasons: [...row.duplicateReasons] })) });
      setSelectedRowIds([]);
      setIsDirty(false);
      setHasSubmitted(false);
    } catch (error) {
      setFileError(error instanceof TypeError ? 'UTF-8 CSV 파일인지 확인해 주세요.' : error instanceof Error ? error.message : 'CSV 파일을 읽지 못했습니다.');
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const setOutcome = (rowId: number, outcome: string) => {
    setData(current => current ? {
      ...current,
      rows: current.rows.map(row => row.id === rowId ? { ...row, outcome } : row)
    } : current);
  };

  const updateCell = (rowId: number, field: string, value: string) => {
    setData(current => current ? {
      ...current,
      rows: (() => {
        const editedRows = current.rows.map(row => {
        if (row.id !== rowId) return row;
        const values = { ...row.values, [field]: value };
        return {
          ...row,
          values,
          errors: validateRow(values),
          warnings: values.url.trim() ? [] : ['답지 URL이 비어 있어 교재만 등록합니다.'],
          duplicateReasons: [],
          outcome: undefined
        };
        });
        if (!duplicateSnapshot) return editedRows;
        const cleanRows = editedRows.map(row => ({
          ...row,
          errors: validateRow(row.values),
          warnings: row.values.url.trim() ? [] : ['답지 URL이 비어 있어 교재만 등록합니다.'],
          duplicateReasons: []
        }));
        return addDuplicateWarnings(cleanRows, duplicateSnapshot.books, duplicateSnapshot.links);
      })()
    } : current);
    setIsDirty(true);
    setSummary(null);
  };

  const addRow = () => {
    if (!data || data.rows.length >= MAX_ROWS) return;
    const nextRowNumber = data.rows.reduce((max, row) => Math.max(max, row.rowNumber), 1) + 1;
    const values = Object.fromEntries(UNIFIED_CSV_COLUMNS.map(column => [column, '']));
    const row: ImportRow = { id: nextRowId.current++, rowNumber: nextRowNumber, values, errors: validateRow(values), warnings: [], duplicateReasons: [] };
    setData(current => current ? { ...current, rows: [...current.rows, row] } : current);
    setSelectedRowIds([]);
    setIsDirty(true);
    setSummary(null);
  };

  const deleteRows = (ids: number[]) => {
    if (!data || !ids.length) return;
    setData(current => {
      if (!current) return current;
      const remaining = current.rows.filter(row => !ids.includes(row.id));
      if (!duplicateSnapshot) return { ...current, rows: remaining };
      const cleanRows = remaining.map(row => ({
        ...row,
        errors: validateRow(row.values),
        warnings: row.values.url.trim() ? [] : ['답지 URL이 비어 있어 교재만 등록합니다.'],
        duplicateReasons: []
      }));
      return { ...current, rows: addDuplicateWarnings(cleanRows, duplicateSnapshot.books, duplicateSnapshot.links) };
    });
    setSelectedRowIds(current => current.filter(id => !ids.includes(id)));
    setIsDirty(true);
    setSummary(null);
  };

  const resetPreview = () => {
    if (!data) return;
    setData(current => current ? {
      ...current,
      rows: current.originalRows.map(row => ({ ...row, values: { ...row.values }, errors: [...row.errors], warnings: [...row.warnings], duplicateReasons: [...row.duplicateReasons], outcome: undefined }))
    } : current);
    setSelectedRowIds([]);
    setIsDirty(false);
    setHasSubmitted(false);
    setSummary(null);
  };

  const startReupload = () => {
    if (data && !window.confirm('현재 미리보기 내용이 사라집니다. 다른 CSV를 다시 업로드할까요?')) return;
    setData(null);
    setDuplicateSnapshot(null);
    setSelectedRowIds([]);
    setIsDirty(false);
    setHasSubmitted(false);
    setSummary(null);
    setDuplicateError('');
    setFileError('');
    fileInputRef.current?.click();
  };

  const registerRows = async () => {
    if (!data || isImporting || checkingDuplicates) return;
    setHasSubmitted(true);
    setDuplicateError('');
    setSummary(null);
    let checkedRows: ImportRow[] = data.rows.map(row => ({
      ...row,
      errors: validateRow(row.values),
      warnings: row.values.url.trim() ? [] : ['답지 URL이 비어 있어 교재만 등록합니다.'],
      duplicateReasons: [],
      outcome: undefined
    }));
    setData(current => current ? { ...current, rows: checkedRows } : current);
    const hasInputErrors = checkedRows.some(row => row.errors.length);
    if (hasInputErrors && !checkedRows.some(row => row.errors.length === 0)) return;

    setCheckingDuplicates(true);
    let existingBooks: Book[];
    let existingLinks: Array<Pick<AnswerLink, 'id' | 'book_id' | 'url'>>;
    try {
      if (!hasSupabaseConfig()) throw new Error('Supabase 환경 변수를 확인해 주세요.');
      const [{ getBooks }, { getAnswerLinksForImport }] = await Promise.all([
        import('../../lib/supabase/books'),
        import('../../lib/supabase/answerLinks')
      ]);
      [existingBooks, existingLinks] = await Promise.all([getBooks(), getAnswerLinksForImport()]);
      checkedRows = addDuplicateWarnings(checkedRows, existingBooks, existingLinks);
      setData(current => current ? { ...current, rows: checkedRows } : current);
    } catch (error) {
      setDuplicateError(error instanceof Error ? `등록 전 교재·링크 확인에 실패했습니다: ${error.message}` : '등록 전 기존 데이터를 확인하지 못했습니다.');
      return;
    } finally {
      setCheckingDuplicates(false);
    }
    const bookDuplicateIds = new Set(checkedRows
      .filter(row => row.errors.length === 0 && row.duplicateReasons.some(reason => reason.type === 'book'))
      .map(row => row.id));
    const validRows = checkedRows.filter(row => row.errors.length === 0 && !bookDuplicateIds.has(row.id));
    checkedRows = checkedRows.map(row => bookDuplicateIds.has(row.id)
      ? { ...row, outcome: '교재 정보가 중복되어 자동 등록을 건너뜀' }
      : row);
    setData(current => current ? { ...current, rows: checkedRows } : current);
    if (!validRows.length) {
      if (!checkedRows.some(row => row.errors.length)) {
        setSummary({ booksCreated: 0, booksReused: 0, linksCreated: 0, skipped: bookDuplicateIds.size, failed: 0, failures: [] });
      }
      return;
    }
    if (checkedRows.some(row => row.errors.length) && !window.confirm(`오류가 있는 ${checkedRows.filter(row => row.errors.length).length}행은 제외하고 정상 행 ${validRows.length}개만 등록할까요?`)) return;
    setIsImporting(true);
    setProgress({ done: 0, total: validRows.length });
    const result: ImportSummary = { booksCreated: 0, booksReused: 0, linksCreated: 0, skipped: checkedRows.length - validRows.length, failed: 0, failures: [] };

    try {
      const [{ createBook, getBooks }, { createAnswerLink }] = await Promise.all([
        import('../../lib/supabase/books'),
        import('../../lib/supabase/answerLinks')
      ]);
      let [knownBooks, knownLinks] = [existingBooks, existingLinks];
      const processedBooks = new Map<string, Book>();
      const processedUrls = new Set<string>();

      for (const row of validRows) {
        try {
          const bookKey = getBookKey({
            title: row.values.title.trim(), publisher: row.values.publisher.trim(), subject: row.values.subject.trim(),
            grade: normalizeGrade(row.values.grade)!, semester: normalizeSemester(row.values.semester)!,
            series: row.values.series.trim()
          });
          let book = processedBooks.get(bookKey);
          let reusedBook = Boolean(book);

          if (!book) {
            const matches = knownBooks.filter(candidate => getBookKeyFromRecord(candidate) === bookKey);
            if (matches.length > 1) throw new Error('같은 교재 정보가 여러 개 있어 자동 연결할 수 없습니다. 관리자 화면에서 확인해 주세요.');
            if (matches.length === 1) {
              book = matches[0];
              reusedBook = true;
            } else {
              const revision = normalizeCurriculumRevision(row.values.curriculum_revision);
              if (revision === null) throw new Error('교육과정 개정 값이 올바르지 않습니다.');
              try {
                book = await createBook({
                  title: row.values.title.trim(), publisher: row.values.publisher.trim(), subject: row.values.subject.trim(),
                  grade: normalizeGrade(row.values.grade)!, semester: normalizeSemester(row.values.semester)!,
                  series: row.values.series.trim() || null,
                  curriculum_revision: revision || null,
                  thumbnail_url: row.values.thumbnail_url.trim() || null,
                  description: row.values.description.trim() || null,
                  book_url: row.values.book_url.trim() || null
                });
                knownBooks.push(book);
                result.booksCreated += 1;
              } catch (createError) {
                knownBooks = await getBooks();
                const retryMatches = knownBooks.filter(candidate => getBookKeyFromRecord(candidate) === bookKey);
                if (retryMatches.length === 1) {
                  book = retryMatches[0];
                  reusedBook = true;
                } else throw createError;
              }
            }
            processedBooks.set(bookKey, book);
          }
          if (reusedBook) result.booksReused += 1;

          if (!row.values.url.trim()) {
            result.skipped += 1;
            setOutcome(row.id, reusedBook ? '기존 교재 재사용 · URL이 없어 교재만 유지' : '교재 등록 완료 · URL이 없어 교재만 등록');
          } else {
            const normalizedUrl = normalizeUrlForDuplicateCheck(row.values.url);
            const isDuplicateLink = processedUrls.has(normalizedUrl) || knownLinks.some(link => areSameAnswerLinkUrl(link.url, row.values.url));
            if (isDuplicateLink) {
              result.skipped += 1;
              setOutcome(row.id, `${reusedBook ? '기존 교재 재사용' : '교재 등록 완료'} · 중복 답지 URL은 건너뜀`);
            } else {
              let saved: AnswerLink;
              try {
                saved = await createAnswerLink({
                  book_id: book.id,
                  title: row.values.link_title.trim(),
                  url: row.values.url.trim(),
                  source_name: row.values.source_name.trim() || undefined,
                  link_type: row.values.link_type.trim() || undefined,
                  verified: false
                });
              } catch (insertError) {
                const code = typeof insertError === 'object' && insertError !== null && 'code' in insertError
                  ? String((insertError as { code?: unknown }).code)
                  : '';
                if (code === '23505') {
                  const { getAnswerLinksForImport } = await import('../../lib/supabase/answerLinks');
                  const latestLinks = await getAnswerLinksForImport();
                  const committedByAnotherAdmin = latestLinks.some(link => areSameAnswerLinkUrl(link.url, row.values.url));
                  if (committedByAnotherAdmin) {
                    knownLinks = latestLinks;
                    processedUrls.add(normalizedUrl);
                    result.skipped += 1;
                    setOutcome(row.id, `${reusedBook ? '기존 교재 재사용' : '교재 등록 완료'} · 다른 관리자가 먼저 등록한 URL이라 건너뜀`);
                    continue;
                  }
                }
                throw insertError;
              }
              knownLinks.push({ id: saved.id, book_id: saved.book_id, url: saved.url });
              processedUrls.add(normalizedUrl);
              result.linksCreated += 1;
              setOutcome(row.id, `${reusedBook ? '기존 교재 재사용' : '교재 등록 완료'} · 미검증 답지 링크 등록`);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '등록에 실패했습니다.';
          result.failed += 1;
          result.failures.push(`${row.rowNumber}행: ${message}`);
          setOutcome(row.id, `실패: ${message}`);
        } finally {
          setProgress(current => ({ ...current, done: current.done + 1 }));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '기존 데이터를 불러오지 못했습니다.';
      result.failed += validRows.length;
      result.failures.push(message);
      setData(current => current ? {
        ...current,
        rows: current.rows.map(row => row.errors.length ? row : { ...row, outcome: `실패: ${message}` })
      } : current);
      setProgress({ done: validRows.length, total: validRows.length });
    } finally {
      setSummary(result);
      setIsImporting(false);
      if (result.booksCreated > 0 || result.linksCreated > 0) {
        window.dispatchEvent(new Event('catalog-data-updated'));
      }
    }
  };

  const rows = data?.rows ?? [];
  const validCount = rows.filter(row => row.errors.length === 0 && !row.duplicateReasons.some(reason => reason.type === 'book')).length;
  const errorCount = rows.filter(row => row.errors.length > 0).length;
  const duplicateCount = rows.filter(row => row.duplicateReasons.length > 0).length;
  const blankUrlCount = rows.filter(row => row.errors.length === 0 && !row.values.url.trim()).length;
  const allRowsSelected = rows.length > 0 && rows.every(row => selectedRowIds.includes(row.id));
  const dropFile = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void chooseFile(event.dataTransfer.files[0]);
  };

  return renderAdminLayout(
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-[#191F28]">통합 CSV 등록</h2>
        <p className="mt-1 text-sm text-[#667085]">한 행에 교재 정보와 선택적 답지 링크를 함께 입력해 등록합니다.</p>
      </div>

      <section className="space-y-4 rounded-2xl border border-[#E5E8EB] bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="font-bold text-base text-[#191F28]">통합 CSV 양식</h3><p className="mt-1 text-sm leading-6 text-[#667085]">빈 양식에는 헤더만 들어 있습니다. 실제 확인된 정보만 입력해 주세요.</p></div>
          <button type="button" onClick={downloadTemplate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2.5 text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB]"><Download className="h-4 w-4" />통합 CSV 빈 양식</button>
        </div>
        <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-4"><code className="block break-all font-mono text-xs leading-5 text-[#667085]">{UNIFIED_CSV_COLUMNS.join(',')}</code></div>
        <p className="text-xs leading-5 text-[#667085]">UTF-8 / UTF-8 BOM, 최대 2MB·500행. 교재명·출판사·과목·학년·학기는 필수입니다. 학년은 ‘전학년’ 또는 초등1·중1·고1 형식으로 입력할 수 있습니다. URL은 HTTPS만 허용하며, url이 비어 있으면 교재만 등록합니다. 답지 링크는 자동으로 미검증 상태로 저장됩니다.</p>
      </section>

      <section
        onDragOver={event => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }}
        onDrop={dropFile}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors sm:p-10 ${isDragging ? 'border-[#667085] bg-[#F9FAFB]' : 'border-[#D0D5DD] bg-white'}`}
      >
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        <Upload className="mx-auto h-7 w-7 text-[#667085]" />
        <p className="mt-3 font-semibold text-[#191F28]">통합 CSV 파일을 여기로 끌어오거나 선택하세요.</p>
        <p className="mt-1 text-sm text-[#667085]">교재만 등록하려면 link_title과 url을 비워 두세요.</p>
        <p className="mt-1 text-xs text-[#667085]">최대 2MB, 500행 · UTF-8 또는 UTF-8 BOM</p>
        {data && <p className="mt-3 inline-flex items-center gap-2 break-all text-sm text-[#344054]"><FileText className="h-4 w-4 shrink-0" />{data.fileName}</p>}
        <div><button type="button" onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="mt-4 min-h-11 rounded-xl bg-[#191F28] px-5 py-3 text-sm font-bold text-white hover:bg-[#333D4B] disabled:opacity-50">CSV 선택</button></div>
      </section>

      {fileError && <div role="alert" className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-4 text-sm text-[#344054]"><span className="font-semibold">CSV 오류: </span>{fileError}</div>}
      {duplicateError && <div role="alert" className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-4 text-sm text-[#344054]"><span className="font-semibold">등록 전 확인 필요: </span>{duplicateError}</div>}
      {checkingDuplicates && <p role="status" className="rounded-xl border border-[#EAECF0] bg-white p-4 text-sm text-[#667085]">기존 교재와 링크를 조회해 중복을 확인하고 있습니다.</p>}

      {data && <>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">전체 행</p><p className="mt-1 text-xl font-bold text-[#191F28]">{rows.length}</p></div>
          <div className="rounded-xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">등록 대상</p><p className="mt-1 text-xl font-bold text-[#191F28]">{validCount}</p></div>
          <div className="rounded-xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">오류 행</p><p className="mt-1 text-xl font-bold text-[#191F28]">{errorCount}</p></div>
          <div className="rounded-xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">중복 경고 행</p><p className="mt-1 text-xl font-bold text-[#191F28]">{duplicateCount}</p></div>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="button" onClick={startReupload} disabled={isImporting} className="min-h-10 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-50">CSV 다시 업로드</button>
          <button type="button" onClick={addRow} disabled={isImporting || rows.length >= MAX_ROWS} className="min-h-10 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-50">행 추가</button>
          <button type="button" onClick={() => deleteRows(selectedRowIds)} disabled={isImporting || selectedRowIds.length === 0} className="min-h-10 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-50">선택 행 삭제 ({selectedRowIds.length})</button>
          <button type="button" onClick={resetPreview} disabled={isImporting || !isDirty} className="min-h-10 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-50">미리보기 초기화</button>
          <span className="text-xs text-[#667085]">행을 삭제하거나 편집한 내용은 최종 등록 전 초기화할 수 있습니다.</span>
        </section>
        {rows.length === 0 && <p className="rounded-xl border border-[#EAECF0] bg-white p-5 text-sm text-[#667085]">미리보기에 행이 없습니다. 행을 추가하거나 CSV를 다시 업로드해 주세요.</p>}

        <section className="overflow-hidden rounded-2xl border border-[#E5E8EB] bg-white">
          <div className="flex flex-col gap-3 border-b border-[#EAECF0] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div><h3 className="font-bold text-base text-[#191F28]">업로드 미리보기 및 편집 <span className="text-sm font-medium text-[#667085]">({data.fileName})</span></h3><p className="mt-1 text-xs text-[#667085]">셀을 직접 수정할 수 있습니다. 업로드와 편집 단계에서는 데이터베이스에 저장하지 않습니다.</p></div>
            <button type="button" onClick={() => void registerRows()} disabled={isImporting || checkingDuplicates || validCount === 0} className="min-h-11 rounded-xl bg-[#191F28] px-4 py-3 text-sm font-bold text-white hover:bg-[#333D4B] disabled:cursor-not-allowed disabled:opacity-50">{isImporting ? `등록 중 ${progress.done}/${progress.total}` : '최종 등록'}</button>
          </div>
          {hasSubmitted && errorCount > 0 && <p role="alert" className="border-b border-[#EAECF0] bg-[#F9FAFB] px-4 py-3 text-sm text-[#344054]">총 {rows.length}행 중 오류 {errorCount}행이 있습니다. 오류 표시된 셀을 수정한 뒤 최종 등록을 다시 눌러 주세요.</p>}
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[1500px] table-fixed text-left text-xs text-[#344054]">
              <thead className="sticky top-0 z-10 bg-[#F9FAFB] text-[#475467]"><tr className="border-b border-[#EAECF0]"><th className="w-12 px-3 py-3"><input type="checkbox" aria-label="모든 행 선택" checked={allRowsSelected} onChange={event => setSelectedRowIds(event.target.checked ? rows.map(row => row.id) : [])} className="h-4 w-4 accent-[#191F28]" /></th><th className="w-14 px-3 py-3">행</th>{UNIFIED_CSV_COLUMNS.map(column => <th key={column} className="min-w-[150px] px-3 py-3 font-semibold">{column}</th>)}<th className="w-[300px] px-3 py-3">검증 결과</th><th className="w-20 px-3 py-3">작업</th></tr></thead>
              <tbody className="divide-y divide-[#EAECF0]">{rows.length === 0 ? <tr><td colSpan={UNIFIED_CSV_COLUMNS.length + 4} className="px-4 py-10 text-center text-sm text-[#667085]">표시할 행이 없습니다.</td></tr> : rows.map(row => <tr key={row.id} className={`align-top hover:bg-[#FCFCFD] ${row.errors.length ? 'bg-[#FFF9F8]' : row.duplicateReasons.length ? 'bg-[#F9FAFB]' : ''}`}>
                <td className="px-3 py-3"><input type="checkbox" aria-label={`${row.rowNumber}행 선택`} checked={selectedRowIds.includes(row.id)} onChange={event => setSelectedRowIds(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} className="h-4 w-4 accent-[#191F28]" /></td>
                <td className="px-3 py-3 font-semibold text-[#667085]">{row.rowNumber}</td>
                {UNIFIED_CSV_COLUMNS.map(column => {
                  const cellErrors = row.errors.filter(issue => issue.field === column);
                  const editorClass = `w-full min-w-[130px] rounded-lg border px-2.5 py-2 text-xs leading-5 text-[#191F28] outline-none focus:ring-2 focus:ring-[#98A2B3]/30 ${cellErrors.length ? 'border-[#D92D20] bg-[#FFF9F8] focus:border-[#D92D20]' : 'border-[#D0D5DD] bg-white focus:border-[#667085]'}`;
                  return <td key={column} className="px-2 py-2 align-top">
                    {column === 'description' || column === 'url' || column === 'book_url' || column === 'thumbnail_url'
                      ? <textarea aria-label={`${row.rowNumber}행 ${column}`} aria-invalid={cellErrors.length > 0} rows={column === 'description' ? 3 : 2} value={row.values[column] ?? ''} onChange={event => updateCell(row.id, column, event.target.value)} className={`${editorClass} resize-y break-all`} />
                      : <input aria-label={`${row.rowNumber}행 ${column}`} aria-invalid={cellErrors.length > 0} value={row.values[column] ?? ''} onChange={event => updateCell(row.id, column, event.target.value)} className={editorClass} />}
                    {cellErrors.map((issue, index) => <p key={`${issue.field}-${index}`} className="mt-1 max-w-[240px] whitespace-normal text-[11px] leading-4 text-[#B42318]">{issue.message}</p>)}
                  </td>;
                })}
                <td className="px-3 py-3">
                  {row.errors.map((issue, index) => <p key={`e-${index}`} className="mb-1 flex gap-1.5 leading-5 text-[#B42318]"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.field}: {issue.message}</p>)}
                  {row.duplicateReasons.map((reason, index) => <p key={`d-${index}`} className="mb-1 flex gap-1.5 break-words font-semibold leading-5 text-[#344054]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />중복: {reason.message}</p>)}
                  {row.warnings.map((message, index) => <p key={`w-${index}`} className="mb-1 flex gap-1.5 leading-5 text-[#475467]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message}</p>)}
                  {row.outcome && <p className="mt-1 flex gap-1.5 break-words leading-5 text-[#191F28]"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{row.outcome}</p>}
                  {!row.errors.length && !row.warnings.length && !row.outcome && <span className="text-[#667085]">정상</span>}
                </td>
                <td className="px-3 py-2"><button type="button" onClick={() => deleteRows([row.id])} disabled={isImporting} className="rounded-lg border border-[#D0D5DD] px-2.5 py-2 text-xs font-semibold text-[#475467] hover:bg-[#F2F4F6] disabled:opacity-50">삭제</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>

        {blankUrlCount > 0 && <p className="rounded-xl border border-[#EAECF0] bg-white p-4 text-sm text-[#667085]">URL이 비어 있는 {blankUrlCount}행은 답지 링크를 만들지 않고 교재 정보만 등록합니다.</p>}
        {isImporting && <div className="rounded-xl border border-[#EAECF0] bg-white p-4"><div className="mb-2 flex justify-between text-sm"><span className="font-semibold text-[#344054]">등록 진행 상황</span><span className="text-[#667085]">{progress.done} / {progress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-[#EAECF0]"><div className="h-full bg-[#344054] transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div><p className="mt-2 flex items-center gap-2 text-xs text-[#667085]"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />행별 결과를 저장하고 있습니다.</p></div>}
        {summary && <section role="status" className="space-y-3 rounded-2xl border border-[#D0D5DD] bg-white p-5 sm:p-6">
          <h3 className="font-bold text-base text-[#191F28]">등록 결과</h3>
          <p className="text-sm leading-6 text-[#344054]">교재 {summary.booksCreated}개 등록 · 기존 교재 {summary.booksReused}회 재사용 · 답지 링크 {summary.linksCreated}개 등록 · 오류 제외/중복/링크 없음 {summary.skipped}행 · 실패 {summary.failed}행</p>
          {summary.failures.length > 0 && <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm text-[#344054]">{summary.failures.map((failure, index) => <li key={index} className="break-words">{failure}</li>)}</ul>}
          <p className="text-xs leading-5 text-[#667085]">일부 행이 실패해도 나머지 행은 계속 처리됩니다. 같은 파일을 다시 올리면 기존 교재와 답지 URL을 확인해 중복을 방지합니다.</p>
        </section>}
      </>}
    </div>
  );
}
