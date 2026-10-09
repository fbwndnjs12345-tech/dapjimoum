import { useEffect } from 'react';

const CLIENT_ID = String(import.meta.env.VITE_ADSENSE_CLIENT_ID ?? '').trim();

function isValidPublisherId(value: string) {
  return /^ca-pub-\d{16}$/.test(value);
}

type AdSenseLoaderProps = { route: string };

export function AdSenseLoader({ route }: AdSenseLoaderProps) {
  useEffect(() => {
    const isPublicContentRoute = route === '/' || route.startsWith('/books/');
    if (!isPublicContentRoute || !isValidPublisherId(CLIENT_ID)) return;

    const existing = document.querySelector<HTMLScriptElement>('script[data-dapji-adsense="true"]');
    if (existing) return;

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.dapjiAdsense = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT_ID)}`;
    document.head.appendChild(script);
  }, [route]);

  return null;
}
