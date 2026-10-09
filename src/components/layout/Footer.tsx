
type FooterProps = { navigateTo: (path: string) => void };

export function Footer({ navigateTo }: FooterProps) {
  return (
      <footer className="border-t border-[#F2F4F6] py-10 mt-20 bg-white">
        <div className="max-w-[1100px] mx-auto px-5 flex flex-col sm:flex-row sm:items-end justify-between gap-5 text-xs text-[#8B95A1]">
          <div className="space-y-2">
            <p className="font-extrabold text-sm text-[#191F28]">답지모음</p>
            <p>교재별 답지 정보를 검색하고 원본 링크를 찾아볼 수 있는 서비스</p>
            <p>© 2026 답지모음. All rights reserved.</p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-4">
            <nav aria-label="사이트 안내" className="flex flex-wrap items-center gap-4 font-bold">
              <button onClick={() => navigateTo('/bookmarks')} className="hover:text-[#191F28]">저장한 교재</button>
              {/* Legal/contact destinations will be connected when supplied. */}
            </nav>
            <nav aria-label="관리자" className="sm:border-t sm:border-[#F2F4F6] sm:pt-3">
              <button onClick={() => navigateTo('/login')} className="font-semibold hover:text-[#191F28]">관리자 로그인</button>
            </nav>
          </div>
        </div>
      </footer>
  );
}
