const SITE_URL = 'https://dapjimoum.pages.dev';
const XML_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
};

const PUBLIC_ROUTES = ['', '/about', '/privacy', '/terms', '/copyright', '/contact'];

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[char]);
}

function qualifiesForIndex(book) {
  const facts = [
    book.publisher,
    book.subject,
    book.grade,
    book.semester,
    book.series,
    book.edition,
  ].filter((value) => String(value ?? '').trim());

  const hasEnoughFacts = Boolean(
    String(book.title ?? '').trim() &&
    String(book.publisher ?? '').trim() &&
    facts.length >= 3
  );
  const hasPlaceholder = /테스트|샘플|seed|example|예시|mock|placeholder/i.test([
    book.title,
    book.publisher,
    book.subject,
    book.grade,
    book.semester,
    book.series,
    book.edition,
    book.description,
  ].join(' '));

  return hasEnoughFacts && !hasPlaceholder;
}

export async function onRequestGet({ request, env }) {
  const urls = new Set(PUBLIC_ROUTES.map((route) => SITE_URL + route));
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Static public pages are always included. Book URLs are added when the
  // public Supabase environment variables are available; failures do not
  // prevent Google from receiving a valid sitemap.
  if (supabaseUrl && anonKey) {
    try {
      const endpoint = new URL('/rest/v1/books', supabaseUrl);
      endpoint.searchParams.set('select', 'id,title,publisher,subject,grade,semester,series,edition,description');
      endpoint.searchParams.set('limit', '1000');
      endpoint.searchParams.set('order', 'title.asc,id.asc');

      const response = await fetch(endpoint, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        signal: AbortSignal.timeout(2500),
      });

      if (response.ok) {
        const books = await response.json();
        for (const book of books) {
          if (qualifiesForIndex(book) && /^[a-zA-Z0-9_-]+$/.test(String(book.id))) {
            urls.add(`${SITE_URL}/books/${encodeURIComponent(book.id)}`);
          }
        }
      }
    } catch {
      // Keep the sitemap available even if the database is temporarily down.
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...urls].map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n') +
    '\n</urlset>\n';

  return new Response(body, {
    status: 200,
    headers: XML_HEADERS,
  });
}
