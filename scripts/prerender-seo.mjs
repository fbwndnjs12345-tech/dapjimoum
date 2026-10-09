import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from 'vite';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, 'dist');
const env = loadEnv('production', projectRoot, ['NEXT_PUBLIC_', 'VITE_']);
const siteUrl = (process.env.VITE_SITE_URL || env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function stripMetaTag(html, attribute, name) {
  return html.replace(new RegExp(`<meta\\s+${attribute}="${name}"[^>]*\\/?\\s*>\\s*`, 'gi'), '');
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !/(^|\.)example\.(com|org|net)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isRecentlyVerified(link) {
  const checkedAt = link.last_checked_at ? new Date(link.last_checked_at).getTime() : 0;
  const age = Date.now() - checkedAt;
  return link.verified && checkedAt > 0 && age >= 0 && age <= 180 * 24 * 60 * 60 * 1000;
}

async function fetchRows(table, select) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const endpoint = new URL(`/rest/v1/${table}`, supabaseUrl);
    endpoint.searchParams.set('select', select);
    endpoint.searchParams.set('order', table === 'books' ? 'title.asc,id.asc' : 'created_at.desc,id.desc');
    endpoint.searchParams.set('limit', String(pageSize));
    endpoint.searchParams.set('offset', String(offset));
    const response = await fetch(endpoint, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    });
    if (!response.ok && table === 'books' && select.includes('edition,')) {
      const legacySelect = select.replace('edition,', '');
      const legacyRows = await fetchRows(table, legacySelect);
      return legacyRows.map(row => ({ ...row, edition: null }));
    }
    if (!response.ok) throw new Error(`Supabase ${table} request returned ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function qualifiesForIndex(book, links) {
  const fields = [book.publisher, book.subject, book.grade, book.semester, book.series, book.edition].filter(value => String(value ?? '').trim());
  const hasCuratedFacts = book.title?.trim() && book.publisher?.trim() && (book.description?.trim().length ?? 0) >= 40 && fields.length >= 3;
  const containsPlaceholder = /테스트|샘플|seed|example|예시|mock|placeholder/i.test([book.title, book.publisher, book.subject, book.grade, book.semester, book.series, book.edition, book.description].join(' '));
  const recentVerification = Date.now() - 180 * 24 * 60 * 60 * 1000;
  return Boolean(hasCuratedFacts && !containsPlaceholder && links.some(link => isRecentlyVerified(link) && isPublicHttpsUrl(link.url)));
}

function pageHtml(template, book, bookLinks, relatedBooks) {
  const canonical = siteUrl ? `${siteUrl}/books/${encodeURIComponent(book.id)}` : '';
  const title = `${book.title} 답지·교재 정보 | 답지모음`;
  const facts = [book.publisher, book.subject, book.grade, book.semester, book.series, book.edition].filter(Boolean);
  const description = `${book.title} · ${facts.join(' · ')}${book.description ? ` · ${book.description}` : ''}`.slice(0, 160);
  const linksMarkup = bookLinks.filter(link => isRecentlyVerified(link) && isPublicHttpsUrl(link.url)).map(link =>
    `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.title)}</a>${link.source_name ? ` <span>(${escapeHtml(link.source_name)})</span>` : ''}${link.last_checked_at ? ` <span>· 확인 ${escapeHtml(new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(link.last_checked_at)))}</span>` : ''}</li>`
  ).join('');
  const bookPageMarkup = isPublicHttpsUrl(book.book_url)
    ? `<p class="mt-3 text-sm"><a href="${escapeHtml(book.book_url)}" rel="noopener noreferrer">교재 페이지 보기</a></p>`
    : '';
  const relatedMarkup = relatedBooks.map(related =>
    `<li><a href="/books/${encodeURIComponent(related.id)}">${escapeHtml(related.title)}</a> <span>${escapeHtml([related.publisher, related.subject, related.grade, related.semester].filter(Boolean).join(' · '))}</span></li>`
  ).join('');
  const content = `<main class="mx-auto max-w-[860px] space-y-6 px-5 py-8"><nav aria-label="Breadcrumb"><a href="/">답지모음 홈</a> <span aria-hidden="true">›</span> <span>${escapeHtml(book.title)}</span></nav><article class="space-y-5"><header class="rounded-3xl border border-[#E5E8EB] bg-white p-6 sm:p-8"><h1 class="text-2xl font-extrabold text-[#191F28]">${escapeHtml(book.title)}</h1><p class="mt-3 text-sm text-[#6B7684]">${escapeHtml(facts.join(' · '))}</p>${book.description ? `<p class="mt-3 text-sm leading-relaxed text-[#6B7684]">${escapeHtml(book.description)}</p>` : ''}${bookPageMarkup}</header><section class="space-y-3"><h2 class="text-lg font-bold text-[#191F28]">검증된 답지 링크</h2><ul class="space-y-2">${linksMarkup}</ul><p class="text-xs text-[#8B95A1]">교재 표지와 학년·학기·시리즈를 확인한 뒤 원본 자료 페이지를 이용하세요. 답지 파일은 이 사이트에 저장하지 않습니다.</p></section>${relatedMarkup ? `<nav class="space-y-3" aria-label="관련 교재"><h2 class="text-lg font-bold text-[#191F28]">관련 교재</h2><ul class="space-y-2">${relatedMarkup}</ul></nav>` : ''}</article></main>`;
  const metas = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    '<meta name="robots" content="index, follow" />',
    '<meta property="og:type" content="article" />',
    '<meta property="og:site_name" content="답지모음" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    '<meta property="og:locale" content="ko_KR" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    ...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}" />`, `<meta property="og:url" content="${escapeHtml(canonical)}" />`] : []),
    ...(isPublicHttpsUrl(book.thumbnail_url) ? [`<meta property="og:image" content="${escapeHtml(book.thumbnail_url)}" />`] : [])
  ].join('\n    ');
  const jsonLd = JSON.stringify([
    { '@context': 'https://schema.org', '@type': 'Book', name: book.title, ...(book.publisher ? { publisher: { '@type': 'Organization', name: book.publisher } } : {}), ...(book.subject ? { genre: book.subject } : {}), ...(book.edition ? { bookEdition: book.edition } : {}), ...(book.description ? { description: book.description } : {}), inLanguage: 'ko' },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '홈', ...(siteUrl ? { item: siteUrl } : {}) }, { '@type': 'ListItem', position: 2, name: book.title, ...(canonical ? { item: canonical } : {}) }] }
  ]).replace(/</g, '\\u003c');
  const cleanedTemplate = [
    ['name', 'description'], ['name', 'robots'], ['name', 'twitter:card'], ['name', 'twitter:title'], ['name', 'twitter:description'],
    ['property', 'og:type'], ['property', 'og:site_name'], ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'], ['property', 'og:locale'], ['property', 'og:image']
  ].reduce((html, [attribute, name]) => stripMetaTag(html, attribute, name), template);
  return cleanedTemplate
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace('</head>', `    ${metas}\n    <script type="application/ld+json">${jsonLd}</script>\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${content}</div>`);
}

const robots = ['User-agent: *', 'Allow: /', ...(siteUrl ? [`Sitemap: ${siteUrl}/sitemap.xml`] : [])].join('\n') + '\n';
await writeFile(path.join(outputRoot, 'robots.txt'), robots, 'utf8');

if (!siteUrl) {
  console.warn('SEO: VITE_SITE_URL is not set; absolute canonical links and sitemap.xml are skipped until the production domain is configured.');
}

let books = [];
let links = [];
if (supabaseUrl && anonKey) {
  try {
    [books, links] = await Promise.all([
      fetchRows('books', 'id,title,publisher,subject,grade,semester,series,edition,description,thumbnail_url,book_url,created_at,updated_at'),
      fetchRows('answer_links', 'id,book_id,title,url,source_name,verified,last_checked_at,created_at')
    ]);
  } catch (error) {
    console.warn(`SEO: Supabase data could not be read during prerender; no book pages were generated (${error.message}).`);
  }
} else {
  console.warn('SEO: Supabase public environment variables are missing; no book pages were generated.');
}

const qualifyingBooks = books.filter(book => qualifiesForIndex(book, links.filter(link => link.book_id === book.id)));
if (qualifyingBooks.length === 0) {
  console.warn('SEO: No verified, sufficiently described Supabase books qualified for indexing; placeholder and unverified rows were excluded.');
}

const template = await readFile(path.join(outputRoot, 'index.html'), 'utf8');
const notFoundHtml = template
  .replace(/<title>[\s\S]*?<\/title>/, '<title>페이지를 찾을 수 없습니다 | 답지모음</title>')
  .replace(/<meta name="robots"[^>]*\/?\s*>/, '<meta name="robots" content="noindex, follow" />')
  .replace('<div id="root"></div>', '<div id="root"><main class="mx-auto max-w-xl space-y-3 px-5 py-20 text-center"><h1 class="text-xl font-bold text-[#191F28]">페이지를 찾을 수 없습니다</h1><p class="text-sm text-[#8B95A1]">주소가 변경되었거나 페이지가 존재하지 않습니다.</p><a href="/" class="inline-block rounded-2xl bg-[#191F28] px-5 py-2.5 text-xs font-bold text-white">홈으로</a></main></div>');
await writeFile(path.join(outputRoot, '404.html'), notFoundHtml, 'utf8');

const nonIndexableRoutes = [
  ['search', '교재 검색 | 답지모음'],
  ['bookmarks', '내 보관함 | 답지모음'],
  ['login', '관리자 로그인 | 답지모음'],
  ['admin', '관리자 | 답지모음'],
  ['admin/books', '교재 관리 | 답지모음'],
  ['admin/books/new', '교재 등록 | 답지모음'],
  ['admin/links', '답지 링크 관리 | 답지모음'],
];
for (const [route, title] of nonIndexableRoutes) {
  const routeHtml = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="robots"[^>]*\/?\s*>/, '<meta name="robots" content="noindex, follow" />');
  const routeDirectory = path.join(outputRoot, route);
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(path.join(routeDirectory, 'index.html'), routeHtml, 'utf8');
}

for (const book of qualifyingBooks) {
  const bookLinks = links.filter(link => link.book_id === book.id && isRecentlyVerified(link) && isPublicHttpsUrl(link.url));
  const related = qualifyingBooks
    .filter(candidate => candidate.id !== book.id && (candidate.subject === book.subject || candidate.publisher === book.publisher || (book.series && candidate.series === book.series)))
    .slice(0, 4);
  const directory = path.join(outputRoot, 'books', book.id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), pageHtml(template, book, bookLinks, related), 'utf8');
}

if (siteUrl) {
  const locations = [siteUrl, ...qualifyingBooks.map(book => `${siteUrl}/books/${encodeURIComponent(book.id)}`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations.map(location => `  <url><loc>${escapeHtml(location)}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(path.join(outputRoot, 'sitemap.xml'), sitemap, 'utf8');
}

console.info(`SEO: prerendered ${qualifyingBooks.length} verified book page(s).`);
