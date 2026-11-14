import { Bookmark, LogOut, Settings } from 'lucide-react';

type HeaderProps = {
  navigateTo: (path: string) => void;
  currentRoute: string;
  bookmarks: string[];
  isAdminLoggedIn: boolean;
  onLogout: () => void | Promise<void>;
};

export function Header({ navigateTo, currentRoute, bookmarks, isAdminLoggedIn, onLogout }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#F2F4F6] min-h-[64px] flex items-center transition-all">
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-5 py-2 sm:py-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
        {/* Brand */}
        <div 
          onClick={() => navigateTo('/')}
          className="cursor-pointer flex items-center gap-2.5 select-none group"
        >
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-[#191F28] group-hover:text-[#3182F6] transition-colors">
              답지모음
            </span>
          </div>
        </div>

        {/* Right Navigation */}
        <nav aria-label="주요 메뉴" className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-1 sm:gap-3 text-sm font-medium text-[#4E5968] overflow-x-auto">
          <button 
            onClick={() => navigateTo('/search')}
            className={`min-h-10 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
              currentRoute === '/search' 
                ? 'bg-[#F2F4F6] text-[#191F28] font-bold' 
                : 'hover:bg-[#F9FAFB] hover:text-[#191F28]'
            }`}
          >
            교재 검색
          </button>

          <button 
            onClick={() => navigateTo('/bookmarks')}
            title="저장한 교재"
            className={`min-h-10 px-3 py-2 rounded-xl whitespace-nowrap transition-all flex items-center gap-1 ${
              currentRoute === '/bookmarks' 
                ? 'bg-[#F2F4F6] text-[#3182F6] font-bold' 
                : 'hover:bg-[#F9FAFB] hover:text-[#191F28]'
            }`}
          >
            <Bookmark className="w-4 h-4" />
            <span className="hidden sm:inline">저장한 교재</span>
            {bookmarks.length > 0 && (
              <span className="bg-[#3182F6] text-white text-[11px] font-bold px-1.5 py-0.2 rounded-full min-w-[18px] text-center">
                {bookmarks.length}
              </span>
            )}
          </button>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2 pl-2 sm:pl-3 border-l border-[#F2F4F6]">
            {isAdminLoggedIn ? (
              <>
              <button 
                onClick={() => navigateTo('/admin')}
                className="min-h-10 text-xs font-bold px-3 py-2 rounded-xl bg-[#E8F3FF] text-[#1B64DA] hover:bg-[#D4E8FF] transition-colors flex items-center gap-1"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>관리자</span>
              </button>
              <button 
                onClick={() => { void onLogout(); }}
                className="min-h-10 min-w-10 flex items-center justify-center p-2 text-[#8B95A1] hover:text-[#191F28] transition-colors"
                title="로그아웃"
              >
                <LogOut className="w-4 h-4" />
              </button>
              </>
            ) : (
              <button 
                onClick={() => navigateTo('/login')}
                className="min-h-10 whitespace-nowrap text-xs font-semibold px-3 py-2 rounded-xl bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB] hover:text-[#191F28] transition-colors"
              >
                관리자 로그인
              </button>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
