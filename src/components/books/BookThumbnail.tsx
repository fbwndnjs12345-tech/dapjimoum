import { useEffect, useState } from 'react';

type BookThumbnailProps = { src?: string | null; alt: string; className: string };
const PLACEHOLDER = '/book-cover-placeholder.svg';

export function BookThumbnail({ src, alt, className }: BookThumbnailProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <img
      loading="lazy"
      decoding="async"
      src={src?.trim() && !failed ? src : PLACEHOLDER}
      alt={src?.trim() && !failed ? alt : `${alt} 표지 미등록`}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
