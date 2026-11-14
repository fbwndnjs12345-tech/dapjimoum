import { useEffect, useState } from 'react';
import { Mail, ShieldCheck, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';

type SiteInfoPageProps = { route: string };

const updatedDate = '2026년 10월 9일';

export function SiteInfoPage({ route }: SiteInfoPageProps) {
  const [editablePage, setEditablePage] = useState<{ title: string; body: string; updated_at: string } | null>(null);
  useEffect(() => {
    let active = true;
    const slug = route.slice(1);
    void supabase.from('site_pages').select('title,body,updated_at').eq('slug', slug).maybeSingle()
      .then(({ data }) => { if (active && data) setEditablePage(data); });
    return () => { active = false; };
  }, [route]);
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL?.trim();
  const title = route === '/about' ? '서비스 소개' : route === '/privacy' ? '개인정보처리방침' : route === '/copyright' ? '저작권 및 링크 정책' : route === '/terms' ? '이용약관' : '문의 및 오류 신고';

  if (editablePage) {
    const blocks = editablePage.body.split(new RegExp(String.fromCharCode(10) + '{2,}')).map(block => block.trim()).filter(Boolean);
    return <article className="mx-auto w-full max-w-3xl px-4 sm:px-5 py-8 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[#667085]"><a href="/" className="hover:text-[#191F28]">답지모음</a><span className="mx-2">›</span><span>{editablePage.title}</span></nav>
      <header className="mb-8 border-b border-[#E5E8EB] pb-6"><h1 className="text-2xl font-extrabold tracking-tight text-[#191F28] sm:text-3xl">{editablePage.title}</h1><p className="mt-3 text-sm text-[#667085]">최종 수정: {new Intl.DateTimeFormat('ko-KR',{dateStyle:'long'}).format(new Date(editablePage.updated_at))}</p></header>
      <div className="space-y-5 text-sm leading-7 text-[#475467]">
        {blocks.map((block,index) => {
          const lines=block.split(String.fromCharCode(10));
          const heading=lines[0].match(/^#{1,3}[ ]+(.+)$/)?.[1] ?? null;
          const content=heading ? lines.slice(1) : lines;
          const isList=content.length>0 && content.every(line => line.startsWith('- '));
          return <section key={index} className="space-y-2">
            {heading && <h2 className="text-lg font-bold text-[#191F28]">{heading}</h2>}
            {isList ? <ul className="list-disc space-y-1 pl-5">{content.map((line,i)=><li key={i}>{line.slice(2)}</li>)}</ul> : content.map((line,i)=><p key={i}>{line}</p>)}
          </section>;
        })}
      </div>
    </article>;
  }

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
          <p>답지모음(이하 “서비스”)은 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」 등 관련 법령을 준수하기 위해 노력합니다. 이 방침은 서비스에서 실제로 제공하는 기능을 기준으로 개인정보 처리 방식과 이용자가 행사할 수 있는 권리를 안내합니다.</p>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">1. 개인정보 처리 목적 및 항목</h2><ul className="list-disc space-y-2 pl-5"><li><strong>교재 검색 및 정보 제공:</strong> 교재명, 출판사, 과목, 학년, 학기 및 외부 링크 정보를 조회해 검색 결과와 교재 페이지를 제공합니다. 이 과정에서 서비스는 Supabase 데이터베이스에 저장된 교재·링크 정보를 읽습니다.</li><li><strong>보관함 기능:</strong> 이용자가 저장한 교재 ID 목록을 해당 브라우저의 로컬 저장소에 저장합니다. 이 정보는 보관함 표시를 위한 것이며 서비스 서버로 전송하도록 구현되어 있지 않습니다. 브라우저 데이터 삭제 또는 기기 변경 시 목록이 사라질 수 있습니다.</li><li><strong>관리자 로그인 및 관리:</strong> 관리자 인증에는 Supabase 인증 기능을 사용합니다. 로그인 시 인증 제공자가 계정 및 세션 정보를 처리할 수 있으며, 관리자만 교재·링크 정보를 등록·수정·삭제할 수 있습니다.</li><li><strong>외부 링크 클릭 집계:</strong> 링크 이동 기능에서 클릭 집계용 식별자와 링크 ID가 서버 기능으로 전달될 수 있습니다. 이는 링크 이용 현황 집계를 위한 것으로, 서비스는 이 기능만으로 이용자의 실명이나 연락처를 알 수 있다고 보장하거나 주장하지 않습니다.</li><li><strong>문의·요청 입력:</strong> 현재 화면의 교재 요청 및 링크 신고 창은 입력 후 안내 메시지만 표시하며, 해당 입력 내용을 서버로 전송·저장하는 기능은 연결되어 있지 않습니다. 실제 문의를 접수하는 기능이 추가되면 처리 항목과 목적을 이 방침에 반영합니다.</li></ul></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">2. 쿠키, 접속 정보 및 광고</h2><p>웹 호스팅·보안·오류 진단을 제공하는 업체는 서비스 운영 과정에서 IP 주소, 브라우저 종류, 접속 시각, 요청한 페이지와 같은 접속 기록을 자체적으로 처리할 수 있습니다. 실제 수집 항목과 보유 기간은 이용 중인 호스팅 업체의 설정 및 정책에 따릅니다.</p><p>Google AdSense 광고가 활성화된 경우 Google 및 제3자 광고 파트너가 쿠키 또는 유사 기술을 사용하여 광고를 제공하고, 광고 빈도·성과를 측정하거나 개인 맞춤 광고를 제공할 수 있습니다. 광고 쿠키 및 데이터 처리에 관한 자세한 사항은 다음 공식 안내를 확인해 주세요.</p><p><a className="font-semibold text-[#1B64DA] underline" href="https://policies.google.com/technologies/ads?hl=ko" target="_blank" rel="noopener noreferrer">Google 광고 기술 및 쿠키 안내 <ExternalLink className="inline h-3 w-3" /></a></p><p>개인 맞춤 광고 설정은 <a className="font-semibold text-[#1B64DA] underline" href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">Google 광고 설정</a>에서 변경할 수 있습니다. 일부 제3자 광고 쿠키는 <a className="font-semibold text-[#1B64DA] underline" href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">Digital Advertising Alliance 선택 페이지</a>에서 관리할 수 있습니다. Google이 파트너 사이트에서 데이터를 사용하는 방식은 <a className="font-semibold text-[#1B64DA] underline" href="https://policies.google.com/technologies/partner-sites?hl=ko" target="_blank" rel="noopener noreferrer">Google 파트너 사이트 데이터 안내</a>를 참고하세요. EEA, 영국 또는 스위스 이용자에게 개인 맞춤 광고를 제공하는 경우 관련 동의 관리 요건이 적용될 수 있습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">3. 개인정보의 보유 및 파기</h2><p>보관함 목록은 이용자의 브라우저 로컬 저장소에 남으며 이용자가 브라우저 설정에서 삭제할 수 있습니다. 관리자 인증 정보 및 세션은 인증 제공자의 정책과 설정에 따라 처리됩니다. 교재·링크 데이터는 서비스 운영을 위해 데이터베이스에 저장되지만, 이는 일반 방문자의 개인정보를 저장한다는 의미는 아닙니다. 접속 기록과 광고 관련 정보의 보유 기간은 각 인프라·광고 제공자의 정책 및 적용 법령에 따릅니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">4. 개인정보 처리의 위탁 및 국외 이전</h2><p>서비스는 데이터베이스·인증 기능 제공을 위해 Supabase를, 광고가 활성화된 경우 광고 제공을 위해 Google 및 광고 파트너를 이용할 수 있습니다. 이들 업체가 정보를 처리하는 위치, 국외 이전 여부, 보유 기간 및 세부 조건은 실제 배포 설정과 각 업체의 정책에 따라 달라질 수 있습니다. 운영자는 출시 전에 이용 중인 제공자, 위탁 업무 및 법령상 필요한 고지 사항을 확인해 최신 상태로 유지합니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">5. 이용자의 권리와 행사 방법</h2><p>이용자는 관련 법령에 따라 개인정보 열람·정정·삭제·처리정지 등을 요청할 수 있습니다. 브라우저에 저장된 보관함 정보는 브라우저 설정에서 직접 삭제할 수 있습니다. 그 밖의 개인정보 관련 요청은 아래 문의 방법을 이용해 주세요. 본인 확인 또는 법령상 제한 사유에 따라 요청 처리 방식이 달라질 수 있습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">6. 아동의 개인정보</h2><p>서비스는 교재 정보를 검색하기 위한 서비스이며, 일반적인 검색 및 보관함 이용을 위해 이름·전화번호 등 개인정보 입력을 요구하지 않습니다. 문의 시 비밀번호나 불필요한 민감정보를 보내지 마세요. 법령상 보호가 필요한 아동의 개인정보가 수집되는 기능을 추가할 경우 필요한 보호 조치를 마련합니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">7. 개인정보 보호를 위한 조치</h2><p>서비스는 관리자 기능을 인증으로 제한하고, 데이터베이스 및 호스팅 제공자가 제공하는 보안 기능을 이용합니다. 구체적인 접근 통제·보관 정책은 배포 환경과 제공자 설정에 따라 달라질 수 있으며, 운영자는 권한 및 보안 설정을 지속적으로 점검합니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">8. 개인정보 보호 책임자 및 문의</h2><p>개인정보 관련 문의는 <a className="font-semibold text-[#1B64DA] underline" href="/contact">문의 및 오류 신고</a> 페이지를 통해 할 수 있습니다.{contactEmail ? <> 운영자 연락 이메일: <a className="font-semibold text-[#1B64DA] underline" href={`mailto:${contactEmail}`}>{contactEmail}</a></> : <> 현재 운영자 연락 이메일이 설정되지 않았습니다. 운영자는 서비스를 공개하기 전에 실제로 확인 가능한 연락처를 설정해야 합니다.</>}</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">9. 방침 변경</h2><p>서비스 기능, 외부 제공자 또는 관련 법령이 변경되면 이 방침을 수정하고 변경 일자와 내용을 이 페이지에 게시합니다.</p></section>
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
          <p>이 이용약관은 답지모음(이하 “서비스”)이 제공하는 교재 정보 검색 및 외부 링크 안내 기능의 이용 조건과 운영 원칙을 정합니다. 이용자는 서비스를 이용함으로써 이 약관을 확인한 것으로 봅니다. 약관에 동의하기 어려운 경우 서비스 이용을 중단할 수 있습니다.</p>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제1조 목적 및 서비스의 성격</h2><p>서비스는 교재명, 출판사, 과목, 학년 등의 정보를 검색하고 관련 자료가 게시된 외부 웹페이지로 이동할 수 있도록 돕는 정보 안내 서비스입니다. 서비스는 답지나 교재 파일 자체를 직접 호스팅·판매·배포하는 것을 기본 기능으로 하지 않으며, 외부 사이트에 있는 자료의 공식성이나 권리자의 허락 여부를 보증하지 않습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제2조 정보의 정확성과 변경</h2><p>교재 정보, 외부 링크, 제공 여부 및 외부 사이트의 내용은 언제든지 변경되거나 삭제될 수 있습니다. 운영자는 정확한 정보를 제공하기 위해 노력하지만 모든 정보가 완전하거나 최신 상태임을 보장하지 않습니다. 이용자는 외부 페이지에서 교재명, 출판사, 판본, 학년·학기 및 자료 내용을 직접 확인해야 합니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제3조 이용자의 준수사항</h2><p>이용자는 관련 법령과 이 약관을 준수해야 하며, 다음 행위를 해서는 안 됩니다.</p><ul className="list-disc space-y-2 pl-5"><li>저작권, 상표권, 개인정보 또는 기타 제3자의 권리를 침해하는 행위</li><li>서비스 또는 외부 사이트에 무단으로 침입하거나 보안 기능을 우회하는 행위</li><li>자동화 도구 등을 이용해 서비스에 과도한 요청을 보내거나 정상적인 운영을 방해하는 행위</li><li>서비스의 정보를 허위·오해의 소지가 있는 방식으로 재게시하거나 운영자를 사칭하는 행위</li><li>불법 자료의 복제·배포 또는 기타 위법한 목적을 위해 서비스를 이용하는 행위</li></ul></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제4조 외부 링크 및 제3자 서비스</h2><p>서비스에는 외부 웹사이트로 연결되는 링크가 포함될 수 있습니다. 외부 사이트의 자료, 광고, 보안, 개인정보 처리, 결제, 다운로드 및 이용 조건은 해당 사이트 운영자가 책임집니다. 이용자는 외부 사이트의 약관과 정책을 확인한 후 자신의 판단과 책임으로 이용해야 합니다. 외부 링크를 제공한다는 사실만으로 서비스가 해당 사이트나 자료를 보증하거나 제휴 관계에 있음을 의미하지 않습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제5조 지식재산권 및 신고</h2><p>서비스의 화면 구성과 자체 작성 콘텐츠에 관한 권리는 관련 권리자에게 귀속됩니다. 교재명, 출판사명, 표지 및 외부 자료에 관한 권리는 각 권리자에게 있습니다. 권리 침해가 의심되는 경우 <a className="font-semibold text-[#1B64DA] underline" href="/copyright">저작권 및 링크 정책</a>을 확인하고 대상 URL과 사유를 포함해 신고할 수 있습니다. 운영자는 신고 내용을 검토한 후 필요한 경우 링크를 수정·제한·삭제할 수 있습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제6조 서비스의 변경·중단</h2><p>운영자는 기능 개선, 점검, 보안, 외부 서비스 장애 또는 기술적 사유로 서비스의 전부 또는 일부를 변경하거나 일시 중단할 수 있습니다. 가능한 경우 중요한 변경 사항을 서비스 내에 안내하도록 노력합니다. 외부 서비스의 사정으로 발생한 장애는 운영자가 직접 통제할 수 없는 경우가 있습니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제7조 책임의 범위</h2><p>운영자는 고의 또는 과실로 인해 법령상 책임이 발생하는 경우를 제외하고, 외부 사이트의 내용·중단·변경이나 이용자가 외부 사이트를 이용함으로써 발생한 손해에 대해 법령이 허용하는 범위에서 책임을 부담하지 않습니다. 이 조항은 관련 법령에 따라 제한할 수 없는 책임을 배제하려는 의미가 아닙니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제8조 개인정보 보호</h2><p>서비스의 개인정보 처리에 관한 사항은 별도의 <a className="font-semibold text-[#1B64DA] underline" href="/privacy">개인정보처리방침</a>에 따릅니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">제9조 약관 변경 및 준거법</h2><p>운영자는 서비스 또는 관련 법령의 변경에 따라 약관을 수정할 수 있으며, 변경된 약관은 이 페이지에 게시한 때부터 적용됩니다. 약관과 관련한 분쟁은 대한민국의 관련 법령에 따라 해결합니다.</p></section>
          <section className="space-y-3"><h2 className="text-lg font-bold text-[#191F28]">부칙</h2><p>본 약관은 {updatedDate}부터 적용합니다. 서비스 운영 형태와 실제 적용 법령을 기준으로 정식 공개 전에 검토 및 보완할 수 있습니다.</p></section>
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
