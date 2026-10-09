type SeoMetadata = {
  title: string;
  description: string;
  path: string;
  robots?: string;
  image?: string;
  structuredData?: Record<string, unknown> | Record<string, unknown>[];
};

function setMeta(name: string, content: string, property = false) {
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    if (property) tag.setAttribute('property', name);
    else tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
}

export function updateSeoMetadata({ title, description, path, robots = 'index, follow', image, structuredData }: SeoMetadata) {
  const canonicalUrl = new URL(path, window.location.origin).toString();
  document.title = title;
  setMeta('description', description);
  setMeta('robots', robots);
  setMeta('og:type', 'website', true);
  setMeta('og:site_name', '답지모음', true);
  setMeta('og:title', title, true);
  setMeta('og:description', description, true);
  setMeta('og:url', canonicalUrl, true);
  setMeta('og:locale', 'ko_KR', true);
  setMeta('twitter:card', image ? 'summary_large_image' : 'summary');
  setMeta('twitter:title', title);
  setMeta('twitter:description', description);

  if (image) {
    setMeta('og:image', image, true);
    setMeta('twitter:image', image);
  } else {
    document.head.querySelector('meta[property="og:image"]')?.remove();
    document.head.querySelector('meta[name="twitter:image"]')?.remove();
  }

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = canonicalUrl;

  document.head.querySelector('#seo-structured-data')?.remove();
  if (structuredData) {
    const script = document.createElement('script');
    script.id = 'seo-structured-data';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(structuredData).replace(/</g, '\\u003c');
    document.head.appendChild(script);
  }
}
