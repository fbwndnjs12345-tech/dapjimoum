import { Mail, ShieldCheck, ExternalLink } from 'lucide-react';

type SiteInfoPageProps = { route: string };

const updatedDate = '2026년 10월 9일';

export function SiteInfoPage({ route }: SiteInfoPageProps) {
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL?.trim();
  const title = route === '/about' ? '서비스 소개' : route === '/privacy' ? '개인정보처리방침' : route === '/copyright' ? '저작권 및 링크 정책' : route === '/terms' ? '이용 안내' : '문의 및 오류 신고';

  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[#6B7684]">
        <a href="/" className="hover:text-[#191F28]">답지모음</a><span className="mx-2" aria-hidden="true">›</span><span>{title}</span>
      </nav>
      <header className="mb-8 border-b border-[#E5E8EB] pb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-[#191F28] sm:text-3xl">{title}</h1>
        <p className="mt-3 text-sm text-[#6B7684]">최종 업데이트: {updatedDate}</p>
      </header>

      {route === '/about' && (
        <div className="space-y-8 text-sm leading-7 text-[#4E5968]">
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">답지모음은 어떤 서비스인가요?</h2><p>답지모음은 교재명, 출판사, 과목, 학년 등의 정보를 바탕으로 교재를 찾고 관련 자료의 원본 페이지로 이동할 수 있도록 돕는 교재 정보 검색 서비스입니다.</p><p>답지 파일 자체를 호스팅하거나 판매하는 서비스가 아닙니다. 외부 링크를 통해 이동하기 전에 교재명과 출판사, 학년·학기 및 시리즈가 일치하는지 확인해 주세요.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">정보의 정확성</h2><p>교재 정보와 외부 링크는 변경되거나 삭제될 수 있습니다. 링크에 문제가 있거나 교재 정보가 잘못된 경우 <a className="font-semibold text-[#1B64DA] underline" href="/contact">문의 및 오류 신고</a> 페이지를 이용해 알려 주세요.</p></section>
          <section className="rounded-2xl border border-[#E5E8EB] bg-[#F9FAFB] p-5"><div className="flex items-center gap-2 font-bold text-[#191F28]"><ShieldCheck className="h-5 w-5" /> 독립적인 정보 검색 서비스</div><p className="mt-2">답지모음은 교재 출판사나 교육기관의 공식 서비스가 아닙니다. 각 교재 및 브랜드의 상표권과 저작권은 해당 권리자에게 있습니다.</p></section>
        </div>
      )}

      {route === '/privacy' && (
        <div className="space-y-8 text-sm leading-7 text-[#4E5968]">
          <p>답지모음은 서비스 운영에 필요한 범위에서 정보를 처리하고, 이용자가 자신의 개인정보 처리 방식을 이해할 수 있도록 이 방침을 공개합니다.</p>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">1. 처리하는 정보와 목적</h2><ul className="list-disc space-y-2 pl-5"><li><strong>보관함:</strong> 저장한 교재 목록은 로그인하지 않은 이용자의 브라우저 로컬 저장소에 저장되며 교재 즐겨찾기 기능에 사용됩니다. 브라우저 데이터 삭제 시 함께 삭제될 수 있습니다.</li><li><strong>관리자 인증:</strong> 관리자 기능은 인증 제공자를 통해 로그인 상태를 확인합니다. 일반 방문자는 관리자 기능을 이용할 필요가 없습니다.</li><li><strong>서비스 요청 및 오류 신고:</strong> 이용자가 직접 제출한 내용은 교재 정보 관리와 링크 오류 확인을 위해 처리될 수 있습니다.</li><li><strong>기술 정보:</strong> 호스팅·보안·오류 진단 과정에서 서버 또는 브라우저가 일반적인 접속·진단 정보를 처리할 수 있습니다.</li></ul></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">2. 외부 서비스와 광고</h2><p>서비스는 데이터 제공 및 관리자 인증을 위해 외부 인프라를 사용할 수 있습니다. Google AdSense 광고가 활성화된 경우 Google 및 광고 파트너가 쿠키 또는 유사 기술을 사용해 광고를 제공·측정할 수 있습니다. 개인 맞춤 광고와 쿠키 설정은 Google의 안내 및 이용 가능한 광고 설정을 통해 관리할 수 있습니다.</p><p><a className="font-semibold text-[#1B64DA] underline" href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">Google 광고 기술 및 쿠키 안내 <ExternalLink className="inline h-3 w-3" /></a></p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">3. 보유 기간과 이용자 권리</h2><p>브라우저에 저장된 보관함 정보는 이용자가 직접 삭제할 수 있습니다. 그 밖의 정보는 처리 목적 달성 및 적용되는 법령에 필요한 기간 동안만 보유하도록 관리합니다. 개인정보 관련 요청은 문의 페이지의 연락 방법을 이용해 주세요.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">4. 아동의 개인정보</h2><p>서비스는 교재 정보 검색을 제공하지만, 이용자의 불필요한 개인정보 입력을 요구하지 않습니다. 문의 시 비밀번호나 민감한 개인정보를 보내지 마세요.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">5. 개인정보 관련 문의</h2><p>개인정보 처리에 관한 문의나 요청은 문의 및 오류 신고 페이지를 이용해 주세요.{contactEmail ? <> 운영자 이메일: <a className="font-semibold text-[#1B64DA] underline" href={`mailto:${contactEmail}`}>{contactEmail}</a></> : null}</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">6. 방침 변경</h2><p>서비스 기능이나 적용 법령이 변경되면 이 방침을 수정하고 변경 내용을 이 페이지에 게시합니다.</p></section>
        </div>
      )}

      {route === '/copyright' && (
        <div className="space-y-8 text-sm leading-7 text-[#4E5968]">
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">외부 링크 안내</h2><p>답지모음은 외부 웹페이지로 연결되는 링크를 안내합니다. 외부 사이트의 내용, 접근 가능 여부, 개인정보 처리 및 이용 약관은 해당 사이트 운영자가 책임집니다. 답지모음은 링크된 자료를 소유하거나 해당 권리자의 공식 사이트임을 의미하지 않습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">저작권 침해 신고</h2><p>본인의 저작권 또는 권리를 침해한다고 생각되는 자료나 링크가 있다면, 권리자임을 확인할 수 있는 정보와 대상 URL, 침해 사유 및 회신 가능한 연락처를 함께 보내 주세요. 확인 후 합리적인 기간 내에 검토하고 필요한 조치를 진행합니다.</p><p>신고 대상 URL은 가능하면 답지모음 내부의 교재 페이지와 원본 외부 URL을 모두 적어 주세요. 허위 신고나 타인의 개인정보를 포함한 자료는 보내지 마세요.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">자료를 직접 호스팅하지 않습니다</h2><p>서비스의 목적은 교재를 식별하고 외부 원본 페이지를 찾도록 돕는 것입니다. 답지 파일을 무단 복제하거나 직접 제공하는 용도로 사용해서는 안 됩니다. 권리자 요청이나 링크의 유효성 확인 결과에 따라 링크가 비공개 또는 삭제될 수 있습니다.</p></section>
          <p><a className="font-semibold text-[#1B64DA] underline" href="/contact">문의 및 오류 신고 페이지로 이동</a></p>
        </div>
      )}

      {route === '/terms' && (
        <div className="space-y-8 text-sm leading-7 text-[#4E5968]">
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">1. 서비스의 성격</h2><p>답지모음은 교재 정보와 외부 자료 링크를 검색하기 위한 안내 서비스입니다. 특정 자료의 정확성, 지속적인 제공 여부 또는 외부 사이트의 안전성을 보장하지 않습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">2. 이용자 준수사항</h2><p>이용자는 서비스를 불법 복제, 저작권 침해, 자동화된 과도한 요청, 보안 우회 또는 타인의 권리를 침해하는 목적으로 사용해서는 안 됩니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">3. 외부 서비스</h2><p>외부 링크를 이용할 때는 해당 사이트의 이용 조건과 저작권 정책을 따라야 합니다. 외부 사이트에서 발생하는 거래, 다운로드, 개인정보 처리 및 손해는 해당 서비스의 정책과 적용 법령에 따라 판단됩니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">4. 정보 변경 및 서비스 중단</h2><p>잘못된 정보, 만료된 링크, 권리 침해 우려가 있는 자료는 사전 안내 없이 수정 또는 제거될 수 있습니다. 서비스는 유지보수나 보안상 필요에 따라 일시적으로 중단될 수 있습니다.</p></section>
        </div>
      )}

      {route === '/contact' && (
        <div className="space-y-8 text-sm leading-7 text-[#4E5968]">
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">교재 정보 및 링크 오류 신고</h2><p>교재명이나 출판사 정보가 잘못되었거나 외부 링크가 열리지 않는 경우, 해당 교재 페이지의 오류 링크 신고 기능을 이용해 주세요. 신고에는 문제가 발생한 교재명, 링크 제목, 오류 내용을 포함하면 검토에 도움이 됩니다.</p><p>저작권 관련 신고는 <a className="font-semibold text-[#1B64DA] underline" href="/copyright">저작권 및 링크 정책</a>을 확인하고, 운영자에게 회신 가능한 연락처와 함께 제출해 주세요.</p></section>
          {contactEmail ? <section className="rounded-2xl border border-[#E5E8EB] p-5"><div className="flex items-center gap-2 font-bold text-[#191F28]"><Mail className="h-5 w-5" /> 운영자 이메일</div><p className="mt-2"><a className="font-semibold text-[#1B64DA] underline" href={`mailto:${contactEmail}`}>{contactEmail}</a></p></section> : <p className="rounded-xl bg-[#FFF8E6] p-4 text-sm text-[#8A5A00]">운영자 연락 이메일이 아직 설정되지 않았습니다. 출시 전에 VITE_CONTACT_EMAIL 환경 변수를 설정해야 합니다.</p>}
        </div>
      )}
    </article>
  );
}
