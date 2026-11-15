import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from 'vite';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, 'dist');
const env = loadEnv('production', projectRoot, ['NEXT_PUBLIC_', 'VITE_']);
const siteUrl = (process.env.VITE_SITE_URL || env.VITE_SITE_URL || 'https://dapjimoum.pages.dev').trim().replace(/\/+$/, '');
const contactEmail = (process.env.VITE_CONTACT_EMAIL || env.VITE_CONTACT_EMAIL || '').trim();
const publisherId = (process.env.VITE_ADSENSE_CLIENT_ID || env.VITE_ADSENSE_CLIENT_ID || '').trim();
const isValidPublisherId = /^ca-pub-\d{16}$/.test(publisherId);
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

function qualifiesForIndex(book) {
  const fields = [book.publisher, book.subject, book.grade, book.semester, book.series, book.edition].filter(value => String(value ?? '').trim());
  // Keep every valid catalog detail page available, but only expose pages with meaningful book-specific content and a real source URL to search indexing.
  const hasUsefulCatalogData = Boolean(book.title?.trim() && book.publisher?.trim() && fields.length >= 3);
  const hasSubstantiveDescription = String(book.description || '').trim().length >= 180;
  const hasSourceUrl = isPublicHttpsUrl(book.book_url);
  const containsPlaceholder = /테스트|샘플|seed|example|예시|mock|placeholder/i.test([book.title, book.publisher, book.subject, book.grade, book.semester, book.series, book.edition, book.description].join(' '));
  return Boolean(hasUsefulCatalogData && hasSubstantiveDescription && hasSourceUrl && !containsPlaceholder);
}

function subjectGuide(book) {
  const subject = String(book.subject || '').toLowerCase();
  if (/수학|math/.test(subject)) return '수학은 개념을 이해한 뒤 예제 풀이 과정을 따라가고, 유사 문제를 스스로 풀어 보는 순서로 활용하세요. 오답은 계산 실수, 개념 이해 부족, 풀이 전략의 문제로 나누어 다시 확인하는 것이 좋습니다.';
  if (/영어|english/.test(subject)) return '영어는 어휘와 문장 구조를 확인한 뒤 지문을 문단별로 읽고 핵심 내용과 연결 표현을 정리하세요. 정답뿐 아니라 오답 선택지가 성립하지 않는 이유도 지문 근거로 설명해 보세요.';
  if (/국어|korean/.test(subject)) return '국어는 글의 갈래와 목적을 파악하고 중심 내용 및 문단 간 관계를 정리하세요. 문제를 풀 때는 선택지의 판단 근거가 되는 문장이나 표현을 지문에서 찾아 확인하세요.';
  if (/과학|science/.test(subject)) return '과학은 용어 암기에 그치지 말고 개념 사이의 원인과 결과, 조건과 변화 과정을 연결해 이해하세요. 그림·표·실험 자료가 있다면 무엇을 비교하는지와 도출되는 결론을 직접 설명해 보세요.';
  if (/사회|역사|도덕|지리|정치|경제/.test(subject)) return '사회 과목은 핵심 용어를 실제 사례와 연결하고 사건·현상 사이의 원인과 결과 및 관점의 차이를 비교하세요. 지도·연표·통계는 제목과 단위를 확인한 뒤 근거를 정리하세요.';
  return '목차와 단원별 학습 목표를 먼저 확인하고, 핵심 개념을 읽은 뒤 예제와 연습 문제를 풀어 보세요. 학습 후에는 틀린 문항의 근거를 본문에서 다시 찾아 정리하면 복습에 도움이 됩니다.';
}

function metadataRows(book) {
  const rows = [['ISBN-13', book.isbn13], ['저자·편집', book.author], ['출판사', book.publisher], ['발행일', book.published_at ? new Intl.DateTimeFormat('ko-KR').format(new Date(book.published_at + 'T00:00:00')) : null], ['페이지 수', Number(book.page_count) > 0 ? Number(book.page_count).toLocaleString('ko-KR') + '쪽' : null], ['정가', Number(book.list_price) > 0 ? Number(book.list_price).toLocaleString('ko-KR') + '원' : null], ['과목', book.subject], ['학년', book.grade], ['학기', book.semester], ['교육과정', book.curriculum_revision], ['판본', book.edition], ['시리즈', book.series]];
  return rows.map(row => '<tr><th scope="row">' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1] || '자료 확인 중') + '</td></tr>').join('');
}

function pageHtml(template, book, bookLinks, relatedBooks) {
  const canonical = siteUrl ? siteUrl + '/books/' + encodeURIComponent(book.id) : '';
  const title = book.title + ' 교재 정보·답지 안내 | 답지모음';
  const facts = [book.publisher, book.subject, book.grade, book.semester, book.series, book.edition].filter(Boolean);
  const description = (book.title + '의 출판사·과목·학년·학기 정보와 교재 소개, 서지정보 및 확인된 답지 링크를 안내합니다. ' + facts.join(' · ')).slice(0, 160);
  const verifiedLinks = bookLinks.filter(link => isRecentlyVerified(link) && isPublicHttpsUrl(link.url));
  const linksMarkup = verifiedLinks.map(link => '<li><a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(link.title) + '</a>' + (link.source_name ? ' <span>(' + escapeHtml(link.source_name) + ')</span>' : '') + '</li>').join('') || '<li>현재 확인된 답지 원본 링크가 없습니다. 교재명과 판본을 확인한 뒤 새 자료가 등록되면 반영합니다.</li>';
  const coverMarkup = isPublicHttpsUrl(book.thumbnail_url) ? '<figure class="mb-5"><img src="' + escapeHtml(book.thumbnail_url) + '" alt="' + escapeHtml(book.title) + ' 교재 표지" loading="eager" decoding="async" style="width:min(220px,60vw);max-height:300px;object-fit:contain" /><figcaption class="mt-2 text-xs text-[#8B95A1]">표지 이미지 · 출처: ' + escapeHtml(book.cover_image_source || '출처 확인 중') + '</figcaption></figure>' : '<p class="mb-5 text-sm text-[#8B95A1]">확인된 표지 이미지가 아직 등록되지 않았습니다.</p>';
  const bookPageMarkup = isPublicHttpsUrl(book.book_url) ? '<p class="mt-3 text-sm"><a href="' + escapeHtml(book.book_url) + '" target="_blank" rel="noopener noreferrer">출판사·서점의 교재 상세 페이지 확인</a></p>' : '<p class="mt-3 text-sm text-[#8B95A1]">공식 교재 상세 페이지 주소는 확인 중입니다.</p>';
  const descriptionMarkup = book.description ? '<section class="space-y-2"><h2 class="text-lg font-bold text-[#191F28]">등록된 교재 소개</h2><p class="text-sm leading-7">' + escapeHtml(book.description) + '</p><p class="text-xs text-[#8B95A1]">소개 문구의 출처와 정확성은 출판사 원문과 대조해 확인해 주세요.</p></section>' : '';
  const useGuide = '<section class="space-y-3"><h2 class="text-lg font-bold text-[#191F28]">' + escapeHtml(book.title) + ' 학습 활용 안내</h2><p class="text-sm leading-7">' + escapeHtml(book.title) + '은(는) ' + escapeHtml([book.grade, book.subject, book.semester].filter(Boolean).join(' ')) + ' 교재로 등록되어 있습니다. 실제 목차와 단원별 학습 목표를 확인하고 현재 수업 진도 및 학습 목적에 맞는 단원부터 활용하세요.</p><p class="text-sm leading-7">' + escapeHtml(subjectGuide(book)) + '</p><h3 class="font-semibold text-[#344054]">교재 확인 체크리스트</h3><ul class="list-disc space-y-1 pl-5 text-sm leading-7"><li>표지의 교재명, 학년, 학기와 판본이 일치하는지 확인합니다.</li><li>개정 교육과정 적용 여부와 발행 연도를 확인합니다.</li><li>답지 자료를 이용하기 전 ISBN과 출판사 정보를 대조합니다.</li><li>목차, 페이지 수, 정가는 실제 교재 또는 출판사 안내에서 최종 확인합니다.</li></ul></section>';
  const relatedMarkup = relatedBooks.map(related => '<li><a href="/books/' + encodeURIComponent(related.id) + '">' + escapeHtml(related.title) + '</a> <span>' + escapeHtml([related.publisher, related.subject, related.grade, related.semester].filter(Boolean).join(' · ')) + '</span></li>').join('');
  const content = '<main class="mx-auto max-w-[860px] space-y-7 px-5 py-8"><nav aria-label="Breadcrumb" class="text-sm"><a href="/">답지모음 홈</a> › ' + escapeHtml(book.title) + '</nav><article class="space-y-7"><header class="rounded-3xl border border-[#E5E8EB] bg-white p-6 sm:p-8">' + coverMarkup + '<h1 class="text-2xl font-extrabold text-[#191F28]">' + escapeHtml(book.title) + '</h1><p class="mt-3 text-sm text-[#6B7684]">' + escapeHtml(facts.join(' · ')) + '</p>' + bookPageMarkup + '</header>' + descriptionMarkup + useGuide + '<section class="space-y-3"><h2 class="text-lg font-bold text-[#191F28]">교재 상세 서지정보</h2><p class="text-sm leading-6">ISBN과 발행 정보를 항목별로 정리했습니다. 확인되지 않은 값은 임의로 추정하지 않고 자료 확인 중으로 표시합니다.</p><div class="overflow-x-auto rounded-xl border border-[#DCE4EE]"><table class="w-full border-collapse text-sm"><tbody>' + metadataRows(book) + '</tbody></table></div></section><section class="space-y-3"><h2 class="text-lg font-bold text-[#191F28]">답지 및 관련 자료</h2><ul class="list-disc space-y-2 pl-5 text-sm">' + linksMarkup + '</ul><p class="text-xs text-[#8B95A1]">답지 링크는 외부 원본 페이지로 연결됩니다. 자료의 출처와 저작권 및 이용 조건을 확인하세요.</p></section>' + (relatedMarkup ? '<nav class="space-y-3" aria-label="관련 교재"><h2 class="text-lg font-bold text-[#191F28]">관련 교재</h2><ul class="list-disc space-y-2 pl-5 text-sm">' + relatedMarkup + '</ul></nav>' : '') + '</article></main>';
  const metas = ['<title>' + escapeHtml(title) + '</title>', '<meta name="description" content="' + escapeHtml(description) + '" />', '<meta name="robots" content="' + (qualifiesForIndex(book) ? 'index, follow' : 'noindex, follow') + '" />', '<meta property="og:type" content="article" />', '<meta property="og:site_name" content="답지모음" />', '<meta property="og:title" content="' + escapeHtml(title) + '" />', '<meta property="og:description" content="' + escapeHtml(description) + '" />', '<meta property="og:locale" content="ko_KR" />', '<meta name="twitter:card" content="' + (isPublicHttpsUrl(book.thumbnail_url) ? 'summary_large_image' : 'summary') + '" />', '<meta name="twitter:title" content="' + escapeHtml(title) + '" />', '<meta name="twitter:description" content="' + escapeHtml(description) + '" />', ...(canonical ? ['<link rel="canonical" href="' + escapeHtml(canonical) + '" />', '<meta property="og:url" content="' + escapeHtml(canonical) + '" />'] : []), ...(isPublicHttpsUrl(book.thumbnail_url) ? ['<meta property="og:image" content="' + escapeHtml(book.thumbnail_url) + '" />'] : [])].join('\n    ');
  const jsonLd = JSON.stringify([
    { '@context': 'https://schema.org', '@type': 'Book', name: book.title, ...(book.publisher ? { publisher: { '@type': 'Organization', name: book.publisher } } : {}), ...(book.subject ? { genre: book.subject } : {}), ...(book.edition ? { bookEdition: book.edition } : {}), ...(book.description ? { description: book.description } : {}), ...(book.isbn13 ? { isbn: book.isbn13 } : {}), ...(book.author ? { author: { '@type': 'Person', name: book.author } } : {}), ...(book.published_at ? { datePublished: book.published_at } : {}), ...(book.page_count ? { numberOfPages: Number(book.page_count) } : {}), ...(isPublicHttpsUrl(book.thumbnail_url) ? { image: book.thumbnail_url } : {}), inLanguage: 'ko' },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '홈', ...(siteUrl ? { item: siteUrl } : {}) }, { '@type': 'ListItem', position: 2, name: book.title, ...(canonical ? { item: canonical } : {}) }] }
  ]).replace(/</g, '\\u003c');
  const cleanedTemplate = [['name', 'description'], ['name', 'robots'], ['name', 'twitter:card'], ['name', 'twitter:title'], ['name', 'twitter:description'], ['property', 'og:type'], ['property', 'og:site_name'], ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'], ['property', 'og:locale'], ['property', 'og:image']].reduce((html, pair) => stripMetaTag(html, pair[0], pair[1]), template);
  return cleanedTemplate.replace(/<title>[\s\S]*?<\/title>/, '').replace('</head>', '    ' + metas + '\n    ' + adsenseCode + '\n    <script type="application/ld+json">' + jsonLd + '</script>\n  </head>').replace('<div id="root"></div>', '<div id="root">' + content + '</div>');
}
const robots = ['User-agent: *', 'Allow: /', ...(siteUrl ? [`Sitemap: ${siteUrl}/sitemap.xml`, `Sitemap: ${siteUrl}/sitemap.txt`] : [])].join('\n') + '\n';
await writeFile(path.join(outputRoot, 'robots.txt'), robots, 'utf8');

if (!siteUrl) {
  console.warn('SEO: VITE_SITE_URL is not set; absolute canonical links and sitemap.xml are skipped until the production domain is configured.');
}

let books = [];
let links = [];
if (supabaseUrl && anonKey) {
  try {
    [books, links] = await Promise.all([
      fetchRows('books', 'id,title,publisher,subject,grade,semester,series,edition,description,thumbnail_url,book_url,isbn13,author,published_at,page_count,list_price,cover_image_source,curriculum_revision,created_at,updated_at'),
      fetchRows('answer_links', 'id,book_id,title,url,source_name,verified,last_checked_at,created_at')
    ]);
  } catch (error) {
    console.warn(`SEO: Supabase data could not be read during prerender; no book pages were generated (${error.message}).`);
  }
} else {
  console.warn('SEO: Supabase public environment variables are missing; no book pages were generated.');
}

const qualifyingBooks = books.filter(book => qualifiesForIndex(book));
if (qualifyingBooks.length === 0) {
  console.warn('SEO: No sufficiently complete textbook catalog rows qualified for indexing; placeholder and incomplete rows were excluded.');
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
  const routeDescription = route === 'search' ? '교재명, 출판사, 과목, 학년, 학기와 시리즈를 기준으로 교재 정보를 검색하고 교재별 상세 정보와 확인된 원본 자료 링크를 살펴보세요.' : '';
  const routeHtml = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="robots"[^>]*\/?\s*>/, '<meta name="robots" content="noindex, follow" />')
    .replace('</head>', `    ${routeDescription ? `<meta name="description" content="${escapeHtml(routeDescription)}" />\n    ${adsenseCode}` : ''}\n  </head>`);
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
    content: '<h1>개인정보처리방침</h1><p>답지모음은 서비스 운영에 필요한 범위에서 정보를 처리하며, 관련 법령을 준수하기 위해 노력합니다.</p><h2>1. 처리 목적 및 항목</h2><p>교재 검색 시 Supabase 데이터베이스에 저장된 교재·외부 링크 정보를 조회합니다. 저장한 교재 ID 목록은 브라우저 로컬 저장소에 저장되며 서버로 전송되도록 구현되어 있지 않습니다. 관리자 로그인은 Supabase 인증 기능을 사용합니다. 외부 링크 클릭 시 링크 ID와 클릭 집계용 식별자가 서버 기능으로 전달될 수 있습니다. 현재 교재 요청 및 링크 신고 창은 입력 내용을 서버로 전송·저장하지 않고 화면에 안내 메시지만 표시합니다.</p><h2>2. 쿠키·접속 정보 및 광고</h2><p>호스팅·보안 업체는 IP 주소, 브라우저 종류, 접속 시각 및 요청 페이지 등 일반적인 접속 정보를 처리할 수 있습니다. Google AdSense가 활성화된 경우 Google 및 광고 파트너가 쿠키 또는 유사 기술을 이용해 광고를 제공·측정하고 개인 맞춤 광고를 제공할 수 있습니다. 자세한 내용은 <a href="https://policies.google.com/technologies/ads?hl=ko" rel="noopener noreferrer">Google 광고 기술 안내</a>를 참고하세요. 개인 맞춤 광고 설정은 <a href="https://adssettings.google.com/" rel="noopener noreferrer">Google 광고 설정</a>에서 변경할 수 있으며, 일부 제3자 광고 쿠키는 <a href="https://www.aboutads.info/choices/" rel="noopener noreferrer">광고 선택 페이지</a>에서 관리할 수 있습니다. Google의 파트너 사이트 데이터 사용에 대해서는 <a href="https://policies.google.com/technologies/partner-sites?hl=ko" rel="noopener noreferrer">Google 파트너 사이트 데이터 안내</a>를 확인하세요.</p><h2>3. 보유 기간·권리·제공자</h2><p>브라우저 보관함은 브라우저 설정에서 삭제할 수 있습니다. 인증 및 접속·광고 관련 정보의 보유 기간은 실제 배포 설정과 각 제공자의 정책 및 관련 법령에 따릅니다. 서비스는 데이터베이스·인증을 위해 Supabase를, 광고가 활성화된 경우 Google 및 광고 파트너를 이용할 수 있습니다. 이용자는 관련 법령에 따라 개인정보 열람·정정·삭제·처리정지 등을 요청할 수 있습니다.</p><h2>4. 개인정보 문의 및 변경</h2><p>개인정보 관련 요청은 <a href="/contact">문의 및 오류 신고</a> 페이지를 이용해 주세요. 운영자 연락처는 서비스 공개 전에 실제로 확인 가능한 연락처로 설정되어야 합니다. 기능이나 제공자가 변경되면 이 방침을 갱신합니다. 최종 업데이트: 2026년 10월 9일.</p>'
  },
  {
    route: 'terms',
    title: '이용약관 | 답지모음',
    description: '답지모음의 서비스 이용 조건, 이용자 준수사항, 외부 링크, 지식재산권 및 책임 범위를 안내합니다.',
    content: '<h1>이용약관</h1><p>이 약관은 답지모음의 교재 정보 검색 및 외부 링크 안내 기능의 이용 조건과 운영 원칙을 정합니다.</p><h2>제1조 서비스의 성격</h2><p>답지모음은 교재 정보를 검색하고 관련 자료가 게시된 외부 웹페이지로 이동하도록 돕는 안내 서비스입니다. 답지 파일 자체를 직접 호스팅하거나 판매·배포하지 않으며, 외부 자료의 정확성·공식성·지속적인 제공 여부를 보증하지 않습니다.</p><h2>제2조 정보의 정확성</h2><p>교재 정보와 외부 링크는 변경되거나 삭제될 수 있습니다. 이용자는 교재명, 출판사, 판본, 학년·학기 및 자료 내용을 외부 페이지에서 직접 확인해야 합니다.</p><h2>제3조 이용자 준수사항</h2><p>이용자는 저작권 침해, 불법 복제·배포, 보안 우회, 과도한 자동화 요청, 타인의 권리 침해 또는 서비스 운영 방해 목적으로 서비스를 이용해서는 안 됩니다.</p><h2>제4조 외부 링크</h2><p>외부 사이트의 자료, 광고, 보안, 개인정보 처리 및 이용 조건은 해당 사이트 운영자가 책임집니다. 외부 링크를 제공한다는 사실만으로 서비스가 해당 사이트나 자료를 보증하거나 제휴 관계에 있음을 의미하지 않습니다.</p><h2>제5조 지식재산권 및 신고</h2><p>교재명, 출판사명 및 외부 자료의 권리는 각 권리자에게 있습니다. 권리 침해가 의심되는 경우 <a href="/copyright">저작권 및 링크 정책</a>에 따라 신고할 수 있으며, 운영자는 검토 후 링크를 수정·제한·삭제할 수 있습니다.</p><h2>제6조 서비스 변경 및 책임</h2><p>운영자는 유지보수, 보안, 외부 서비스 장애 또는 기술적 사유로 서비스를 변경하거나 일시 중단할 수 있습니다. 이 약관은 관련 법령상 제한할 수 없는 책임을 배제하지 않습니다.</p><h2>제7조 개인정보 및 약관 변경</h2><p>개인정보 처리에 관한 사항은 <a href="/privacy">개인정보처리방침</a>에 따릅니다. 약관 변경 시 이 페이지에 변경 내용을 게시합니다. 대한민국의 관련 법령을 준거법으로 합니다.</p><p>최종 업데이트: 2026년 10월 9일</p>'
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
    .replace('</head>', `    ${canonical}\n    ${adsenseCode}\n    <meta property="og:type" content="website" />\n    <meta property="og:site_name" content="답지모음" />\n    <meta property="og:title" content="${escapeHtml(page.title)}" />\n    <meta property="og:description" content="${escapeHtml(page.description)}" />\n    <meta property="og:url" content="${escapeHtml(siteUrl + pagePath)}" />\n    <meta property="og:locale" content="ko_KR" />\n    <meta name="twitter:card" content="summary" />\n    <meta name="twitter:title" content="${escapeHtml(page.title)}" />\n    <meta name="twitter:description" content="${escapeHtml(page.description)}" />\n    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, description: page.description, url: siteUrl + pagePath, inLanguage: 'ko-KR', isPartOf: { '@type': 'WebSite', name: '답지모음', url: siteUrl } }).replace(/</g, '\\\\u003c')}</script>\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><main class="mx-auto max-w-3xl space-y-5 px-5 py-10 text-sm leading-7 text-[#4E5968]"><nav aria-label="Breadcrumb"><a href="/">답지모음</a> › ${escapeHtml(page.title.split(' | ')[0])}</nav><article>${page.content}</article></main></div>`);
  const routeDirectory = path.join(outputRoot, page.route);
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(path.join(routeDirectory, 'index.html'), pageHtml, 'utf8');
}

if (isValidPublisherId) {
  await writeFile(path.join(outputRoot, 'ads.txt'), `google.com, ${publisherId.slice(7)}, DIRECT, f08c47fec0942fa0\n`, 'utf8');
} else {
  console.warn('AdSense: VITE_ADSENSE_CLIENT_ID is not configured; ads.txt was not generated. Set the real ca-pub- ID after adding the production site to your AdSense account, before submitting it for review.');
}

for (const book of books) {
  const bookLinks = links.filter(link => link.book_id === book.id && isRecentlyVerified(link) && isPublicHttpsUrl(link.url));
  const related = qualifyingBooks
    .filter(candidate => candidate.id !== book.id && ((book.series && candidate.series === book.series) || (candidate.subject === book.subject && candidate.grade === book.grade)))
    .sort((a, b) => {
      const score = candidate => Number(Boolean(book.series) && candidate.series === book.series) * 4 + Number(candidate.subject === book.subject && candidate.grade === book.grade) * 2 + Number(candidate.publisher === book.publisher);
      return score(b) - score(a);
    })
    .slice(0, 4);
  const directory = path.join(outputRoot, 'books', book.id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), pageHtml(template, book, bookLinks, related), 'utf8');
}

if (siteUrl) {
  const locations = [siteUrl, ...publicInfoPages.map(page => `${siteUrl}/${page.route}`), ...qualifyingBooks.map(book => `${siteUrl}/books/${encodeURIComponent(book.id)}`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations.map(location => `  <url><loc>${escapeHtml(location)}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(path.join(outputRoot, 'sitemap.xml'), sitemap, 'utf8');
  // Plain-text sitemap is an independent fallback for crawlers or CDN rules
  // that mishandle XML content types. Keep exactly the same canonical URLs.
  await writeFile(path.join(outputRoot, 'sitemap.txt'), `${locations.join('\n')}\n`, 'utf8');
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
  .replace(/<title>[\s\S]*?<\/title>/, '<title>답지모음 | 초·중·고 교재 답지 링크 검색</title>')
  .replace(/<meta name="description"[^>]*\/?\s*>/, '<meta name="description" content="교재명, 출판사, 과목, 학년과 학기로 초·중·고 교재 정보를 찾고 확인된 원본 답지 링크를 검색하세요." />')
  .replace(/<meta property="og:title"[^>]*\/?\s*>/, '<meta property="og:title" content="답지모음 | 초·중·고 교재 답지 링크 검색" />')
  .replace(/<meta property="og:description"[^>]*\/?\s*>/, '<meta property="og:description" content="교재명, 출판사, 과목, 학년과 학기로 초·중·고 교재 정보를 찾고 확인된 원본 답지 링크를 검색하세요." />')
  .replace('</head>', `    ${homeCanonical}\n    ${adsenseCode}\n    <script type="application/ld+json">${homeStructuredData}</script>\n  </head>`)
  .replace('<div id="root"></div>', `<div id="root">${homeContent}</div>`);
await writeFile(path.join(outputRoot, 'index.html'), homeHtml, 'utf8');

console.info(`SEO: prerendered ${qualifyingBooks.length} catalog book page(s).`);
