import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from 'vite';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, 'dist');
const env = loadEnv('production', projectRoot, ['NEXT_PUBLIC_', 'VITE_']);
const siteUrl = (process.env.VITE_SITE_URL || env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
const contactEmail = (process.env.VITE_CONTACT_EMAIL || env.VITE_CONTACT_EMAIL || '').trim();
const publisherId = (process.env.VITE_ADSENSE_CLIENT_ID || env.VITE_ADSENSE_CLIENT_ID || '').trim();
const isValidPublisherId = /^ca-pub-\\d{16}$/.test(publisherId);
const adsenseCode = isValidPublisherId
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}" crossorigin="anonymous"></script>`
  : '';
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
     .replace('</head>', `    ${metas}\n    ${adsenseCode}\n    <script type="application/ld+json">${jsonLd}</script>\n  </head>`)
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
  ['admin/import', 'CSV 일괄 등록 | 답지모음'],
  ['admin/link-search', '답지 링크 자동 검색 | 답지모음'],
];
for (const [route, title] of nonIndexableRoutes) {
  const routeHtml = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="robots"[^>]*\/?\s*>/, '<meta name="robots" content="noindex, follow" />');
  const routeDirectory = path.join(outputRoot, route);
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(path.join(routeDirectory, 'index.html'), routeHtml, 'utf8');
}

const publicInfoPages = [
  {
    route: 'about',
    title: '서비스 소개 | 답지모음',
    description: '답지모음의 교재 정보 검색 방식과 외부 원본 링크 안내, 정보 정확성 및 서비스 운영 원칙을 소개합니다.',
    content: '<h1>답지모음 서비스 소개</h1><p>답지모음은 교재명, 출판사, 과목, 학년 등의 정보를 바탕으로 교재를 찾고 관련 자료의 원본 페이지로 이동하도록 돕는 교재 정보 검색 서비스입니다.</p><h2>외부 원본 링크 안내</h2><p>답지 파일 자체를 호스팅하거나 판매하지 않습니다. 외부 링크를 이용하기 전에 교재명, 출판사, 학년·학기 및 시리즈가 일치하는지 확인해 주세요.</p><h2>정보의 정확성</h2><p>교재 정보와 외부 링크는 변경되거나 삭제될 수 있습니다. 오류는 문의 및 오류 신고 페이지를 통해 알려 주세요.</p><p>답지모음은 교재 출판사나 교육기관의 공식 서비스가 아닙니다.</p>'
  },
  {
    route: 'privacy',
    title: '개인정보처리방침 | 답지모음',
    description: '답지모음에서 처리하는 정보, 브라우저 보관함, 외부 서비스와 광고, 개인정보 관련 이용자 권리를 안내합니다.',
    content: '<h1>개인정보처리방침</h1><p>답지모음은 서비스 운영에 필요한 범위에서 정보를 처리합니다.</p><h2>처리하는 정보</h2><p>저장한 교재 목록은 브라우저 로컬 저장소에 저장됩니다. 관리자 기능은 인증 제공자를 통해 로그인 상태를 확인합니다. 이용자가 직접 제출한 오류 신고 내용은 교재 정보와 링크를 확인하는 데 사용될 수 있습니다.</p><h2>외부 서비스와 광고</h2><p>Google AdSense 광고가 활성화된 경우 Google 및 광고 파트너가 쿠키 또는 유사 기술을 사용해 광고를 제공하고 측정할 수 있습니다. 자세한 내용은 <a href="https://policies.google.com/technologies/ads" rel="noopener noreferrer">Google 광고 기술 안내</a>를 확인해 주세요. 개인 맞춤 광고 설정은 <a href="https://adssettings.google.com/" rel="noopener noreferrer">Google 광고 설정</a>에서 변경할 수 있으며, 일부 제3자 광고 쿠키는 <a href="https://www.aboutads.info/choices/" rel="noopener noreferrer">Digital Advertising Alliance 선택 페이지</a>에서 관리할 수 있습니다. Google이 파트너 사이트에서 데이터를 사용하는 방식은 <a href="https://policies.google.com/technologies/partner-sites?hl=ko" rel="noopener noreferrer">Google 파트너 사이트 데이터 안내</a>를 참고하세요.</p><h2>이용자 권리 및 방침 변경</h2><p>브라우저에 저장된 보관함은 이용자가 직접 삭제할 수 있습니다. 개인정보 관련 요청 및 방침 변경 문의는 문의 페이지를 이용해 주세요.</p><p>개인정보 처리에 관한 문의는 <a href="/contact">문의 및 오류 신고</a> 페이지를 이용해 주세요.</p>'
  },
  {
    route: 'terms',
    title: '이용 안내 | 답지모음',
    description: '답지모음 서비스 이용 원칙과 외부 링크 이용 시 유의사항을 확인하세요.',
    content: '<h1>이용 안내</h1><h2>서비스의 성격</h2><p>답지모음은 교재 정보와 외부 자료 링크를 검색하기 위한 안내 서비스입니다. 특정 자료의 정확성, 지속적인 제공 여부 또는 외부 사이트의 안전성을 보장하지 않습니다.</p><h2>이용자 준수사항</h2><p>서비스를 불법 복제, 저작권 침해, 자동화된 과도한 요청, 보안 우회 또는 타인의 권리를 침해하는 목적으로 사용해서는 안 됩니다.</p><h2>외부 서비스 및 정보 변경</h2><p>외부 링크를 이용할 때는 해당 사이트의 이용 조건과 저작권 정책을 따라야 합니다. 잘못된 정보나 권리 침해 우려가 있는 자료는 수정 또는 제거될 수 있습니다.</p>'
  },
  {
    route: 'copyright',
    title: '저작권 및 링크 정책 | 답지모음',
    description: '답지모음의 외부 링크 운영 방식과 저작권 침해 신고 절차를 안내합니다.',
    content: '<h1>저작권 및 링크 정책</h1><h2>외부 링크 안내</h2><p>답지모음은 외부 웹페이지로 연결되는 링크를 안내합니다. 외부 사이트의 내용과 개인정보 처리, 이용 조건은 해당 사이트 운영자가 책임집니다.</p><h2>저작권 침해 신고</h2><p>권리 침해가 의심되는 링크를 신고할 때는 대상 URL, 침해 사유, 권리자임을 확인할 수 있는 정보 및 회신 가능한 연락처를 포함해 주세요. 확인 후 검토하고 필요한 조치를 진행합니다.</p><h2>자료를 직접 호스팅하지 않습니다</h2><p>답지모음은 답지 파일을 무단 복제하거나 직접 제공하는 용도로 사용해서는 안 됩니다. 권리자 요청이나 링크 확인 결과에 따라 링크가 제거될 수 있습니다.</p><p><a href="/contact">문의 및 오류 신고</a></p>'
  },
  {
    route: 'contact',
    title: '문의 및 오류 신고 | 답지모음',
    description: '교재 정보 오류, 외부 링크 오류 및 저작권 관련 문의 방법을 안내합니다.',
    content: '<h1>문의 및 오류 신고</h1><h2>교재 정보 및 링크 오류</h2><p>교재명이나 출판사 정보가 잘못되었거나 외부 링크가 열리지 않는 경우, 해당 교재 페이지의 오류 링크 신고 기능을 이용해 주세요. 교재명, 링크 제목 및 오류 내용을 포함하면 검토에 도움이 됩니다.</p><h2>저작권 관련 신고</h2><p>저작권 관련 신고에는 대상 URL, 침해 사유 및 회신 가능한 연락처를 포함해 주세요. ' +
      (contactEmail ? `운영자 이메일: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.` : '운영자 이메일은 아직 등록되지 않았습니다.') +
      '</p><p><a href="/copyright">저작권 및 링크 정책</a></p>'
  }
];

for (const page of publicInfoPages) {
  const pagePath = `/${page.route}`;
  const canonical = siteUrl ? `<link rel="canonical" href="${escapeHtml(siteUrl + pagePath)}" />` : '';
  const pageHtml = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/<meta name="description"[^>]*\/?\s*>/, `<meta name="description" content="${escapeHtml(page.description)}" />`)
    .replace(/<meta name="robots"[^>]*\/?\s*>/, '<meta name="robots" content="index, follow" />')
    .replace('</head>', `    ${canonical}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><main class="mx-auto max-w-3xl space-y-5 px-5 py-10 text-sm leading-7 text-[#4E5968]"><nav aria-label="Breadcrumb"><a href="/">답지모음</a> › ${escapeHtml(page.title.split(' | ')[0])}</nav><article>${page.content}</article></main></div>`);
  const routeDirectory = path.join(outputRoot, page.route);
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(path.join(routeDirectory, 'index.html'), pageHtml, 'utf8');
}

if (isValidPublisherId) {
  await writeFile(path.join(outputRoot, 'ads.txt'), `google.com, ${publisherId.slice(7)}, DIRECT, f08c47fec0942fa0\n`, 'utf8');
} else {
  console.warn('AdSense: VITE_ADSENSE_CLIENT_ID is not configured; ads.txt was not generated. Set the real ca-pub- ID from your AdSense account after the site is approved/registered.');
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
  const locations = [siteUrl, ...publicInfoPages.map(page => `${siteUrl}/${page.route}`), ...qualifyingBooks.map(book => `${siteUrl}/books/${encodeURIComponent(book.id)}`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations.map(location => `  <url><loc>${escapeHtml(location)}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(path.join(outputRoot, 'sitemap.xml'), sitemap, 'utf8');
}


const homeCanonical = siteUrl ? `<link rel="canonical" href="${escapeHtml(siteUrl)}" />` : '';
const homeStructuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: '답지모음',
  ...(siteUrl ? { url: siteUrl } : {}),
  inLanguage: 'ko-KR'
}).replace(/</g, '\\u003c');
const homeContent = '<main class="mx-auto max-w-[1100px] space-y-10 px-5 py-10 text-sm leading-7 text-[#4E5968]"><section><h1 class="text-3xl font-extrabold tracking-tight text-[#191F28]">교재별 답지와 교재 정보를 찾아보세요</h1><p class="mt-4 max-w-3xl">답지모음은 교재명, 출판사, 과목, 학년과 학기 등의 정보를 바탕으로 교재를 찾고 관련 자료의 원본 페이지로 이동하도록 돕는 검색 서비스입니다.</p><p class="mt-3"><a class="font-bold text-[#1B64DA] underline" href="/search">교재 검색 시작하기</a></p></section><section><h2 class="text-xl font-bold text-[#191F28]">교재를 확인할 때 살펴볼 정보</h2><ul class="mt-3 list-disc space-y-2 pl-5"><li>교재명과 출판사 이름이 정확히 일치하는지 확인하세요.</li><li>학년, 학기, 과목과 시리즈가 실제 교재와 일치하는지 확인하세요.</li><li>외부 링크로 이동한 뒤 자료의 출처와 이용 조건을 확인하세요.</li><li>링크가 작동하지 않거나 정보가 다르면 오류 신고 기능을 이용해 주세요.</li></ul></section><section><h2 class="text-xl font-bold text-[#191F28]">원본 링크와 저작권</h2><p class="mt-3">답지모음은 답지 파일을 직접 저장하거나 판매하지 않습니다. 등록된 외부 페이지로 연결해 드리며, 해당 페이지의 콘텐츠와 이용 조건은 원본 사이트 및 권리자의 정책을 따릅니다.</p><p class="mt-3"><a class="font-semibold text-[#1B64DA] underline" href="/copyright">저작권 및 링크 정책</a> · <a class="font-semibold text-[#1B64DA] underline" href="/privacy">개인정보처리방침</a> · <a class="font-semibold text-[#1B64DA] underline" href="/contact">문의 및 오류 신고</a></p></section></main>';
const homeHtml = template
   .replace('</head>', `    ${homeCanonical}\n    ${adsenseCode}\n    <script type="application/ld+json">${homeStructuredData}</script>\n  </head>`)
  .replace('<div id="root"></div>', `<div id="root">${homeContent}</div>`);
await writeFile(path.join(outputRoot, 'index.html'), homeHtml, 'utf8');

console.info(`SEO: prerendered ${qualifyingBooks.length} verified book page(s).`);
