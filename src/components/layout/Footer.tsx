import type { MouseEvent } from 'react';

type FooterProps = { navigateTo: (path: string) => void };

const footerLinks = [
  { href: '/about', label: '서비스 소개' },
  { href: '/privacy', label: '개인정보처리방침' },
  { href: '/terms', label: '이용 안내' },
  { href: '/copyright', label: '저작권·링크 정책' },
  { href: '/contact', label: '문의 및 오류 신고' },
];

export function Footer({ navigateTo }: FooterProps) {
  const handleInternalLink = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateTo(href);
  };

  return (
    <footer className="mt-20 border-t border-[#F2F4F6] bg-white py-10">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-5 text-xs text-[#8B95A1]">
        <div className="space-y-2">
          <p className="text-sm font-extrabold text-[#191F28]">답지모음</p>
          <p>교재별 답지 정보를 검색하고 원본 링크를 찾아볼 수 있는 서비스</p>
          <p>답지 파일을 직접 저장하지 않으며, 외부 자료는 원본 페이지에서 확인할 수 있습니다.</p>
          <p>© 2026 답지모음. All rights reserved.</p>
        </div>
        <nav aria-label="사이트 정보" className="flex flex-wrap gap-x-5 gap-y-3 font-semibold">
          {footerLinks.map(link => (
            <a key={link.href} href={link.href} onClick={event => handleInternalLink(event, link.href)} className="underline-offset-4 hover:text-[#191F28] hover:underline">
              {link.label}
            </a>
          ))}
          <a href="/bookmarks" onClick={event => handleInternalLink(event, '/bookmarks')} className="underline-offset-4 hover:text-[#191F28] hover:underline">저장한 교재</a>
          <a href="/login" onClick={event => handleInternalLink(event, '/login')} className="underline-offset-4 hover:text-[#191F28] hover:underline">관리자 로그인</a>
        </nav>
      </div>
    </footer>
  );
}
