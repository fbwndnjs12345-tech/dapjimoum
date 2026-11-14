create table if not exists public.site_pages (
  slug text primary key check (slug in ('about','privacy','terms','copyright','contact')),
  title text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.site_pages enable row level security;
grant select on public.site_pages to anon, authenticated;
grant insert, update on public.site_pages to authenticated;
drop policy if exists "Public can read site pages" on public.site_pages;
create policy "Public can read site pages" on public.site_pages for select to anon, authenticated using (true);
drop policy if exists "Admins can insert site pages" on public.site_pages;
create policy "Admins can insert site pages" on public.site_pages for insert to authenticated with check ((select public.is_admin_user()) and updated_by = (select auth.uid()));
drop policy if exists "Admins can update site pages" on public.site_pages;
create policy "Admins can update site pages" on public.site_pages for update to authenticated using ((select public.is_admin_user())) with check ((select public.is_admin_user()) and updated_by = (select auth.uid()));

insert into public.site_pages (slug,title,body) values
('about','서비스 소개', E'# 답지모음 소개\n답지모음은 교재명, 출판사, 과목, 학년, 학기 및 시리즈 정보를 바탕으로 교재를 찾고 관련 외부 원본 페이지로 이동할 수 있도록 돕는 교재 정보 검색 서비스입니다.\n\n## 제공 기능\n- 교재 검색과 교재별 답지 링크 안내\n- 브라우저에 교재를 저장하는 보관함\n- 이용자의 교재 등록 요청 및 링크 오류 신고 접수\n- 관리자의 교재·링크 관리와 자동 검색 후보 검토\n\n## 외부 링크와 정확성\n답지모음은 답지 파일을 직접 호스팅하거나 판매하지 않습니다. 링크는 외부 웹페이지로 연결되며, 자료의 존재·정확성·최신성·권리자의 허락 여부를 보증하지 않습니다. 이용자는 교재명, 출판사, 판본, 학년·학기와 원본 페이지의 내용을 직접 확인해야 합니다.\n\n## 독립 서비스\n답지모음은 교재 출판사, 교육기관 또는 저작권자의 공식 서비스가 아니며, 별도 제휴가 표시되지 않는 한 이들과 제휴·승인 관계가 없습니다. 각 교재명, 상표, 표지 및 저작물의 권리는 해당 권리자에게 있습니다.'),
('privacy','개인정보처리방침', E'# 개인정보처리방침\n시행일: 2026년 11월 14일\n\n## 1. 처리하는 정보와 목적\n- 교재 요청: 이용자가 입력한 교재명과 선택 입력한 출판사 정보를 접수·처리합니다.\n- 링크 오류 신고: 교재명, 링크 식별정보 또는 제목, 신고 사유, 신고 URL 및 상세 내용을 접수·처리합니다.\n- 관리자 계정: Supabase 인증을 통해 관리자 로그인과 권한 확인을 수행합니다.\n- 보관함: 저장한 교재 ID 목록은 현재 이용자의 브라우저 로컬 저장소에 보관되며 서비스 계정으로 전송되지 않습니다.\n- 서비스 운영: 호스팅·데이터베이스·보안 제공자가 요청 처리 과정에서 IP 주소, 접속 시각, 브라우저·기기 정보 및 오류 로그를 처리할 수 있습니다. 실제 항목은 각 제공자의 설정과 정책을 따릅니다.\n\n## 2. 접수 정보의 저장과 접근\n교재 요청 및 링크 오류 신고는 Supabase 데이터베이스의 접수 테이블에 저장됩니다. 접수 상태와 처리 기록은 관리자 화면에서 관리하며, 일반 방문자는 다른 이용자의 접수 내용을 조회할 수 없습니다. 관리자 계정은 교재·링크·접수 관리 목적으로 인증됩니다. 비밀번호, 주민등록번호, 결제정보 등 불필요한 민감정보를 신고 내용에 입력하지 마세요.\n\n## 3. 보유 및 파기\n현재 접수 정보의 자동 보존기간 만료·파기 작업은 별도로 설정되어 있지 않습니다. 운영자는 처리 목적 달성 후 불필요한 정보를 지체 없이 삭제하고, 분쟁·법령상 보존 의무가 있는 경우 필요한 범위에서만 보관해야 합니다. 정식 공개 전에 운영자가 구체적인 보유기간과 파기 절차를 확정·설정해야 합니다. 브라우저 보관함은 이용자가 브라우저 저장공간을 삭제하면 제거됩니다.\n\n## 4. 처리 위탁 및 국외 이전\n서비스는 데이터베이스·인증 기능에 Supabase를, 웹 배포·호스팅에 Cloudflare Pages를 이용합니다. 각 제공자의 처리 위치, 국외 이전 여부, 재위탁, 보유기간 및 보호조치는 실제 프로젝트 리전·계약·설정과 제공자 정책을 확인하여 운영자가 구체적으로 기재해야 합니다. 현재 이 문서만으로 데이터 저장 국가나 국외 이전의 세부 사항을 확정하지 않습니다.\n\n## 5. 쿠키 및 광고\n브라우저 보관함은 localStorage를 사용합니다. Cloudflare 및 외부 서비스가 보안·성능·접속 로그를 처리할 수 있습니다. Google AdSense 등 광고가 실제 활성화된 경우에만 해당 광고 제공자와 파트너가 쿠키 또는 유사 기술을 사용할 수 있습니다. 광고가 활성화되어 있는지, 동의 관리가 필요한 지역에 적절한 동의 도구가 적용되어 있는지는 출시 전에 확인해야 합니다.\n\n## 6. 이용자의 권리\n이용자는 관련 법령에 따라 개인정보 열람·정정·삭제·처리정지 등을 요청할 수 있습니다. 요청은 문의 및 오류 신고 페이지의 운영자 연락처를 통해 접수할 수 있으며, 본인 확인 및 법령상 제한 여부를 확인한 뒤 처리합니다.\n\n## 7. 아동 및 민감정보\n일반 검색과 보관함 이용에는 이름·전화번호 등 개인정보 입력이 필요하지 않습니다. 문의·신고 양식에는 처리에 필요한 최소 정보만 입력하고 민감정보를 보내지 마세요.\n\n## 8. 개인정보 보호 책임자 및 연락처\n개인정보 보호 책임자의 성명·직책, 실제 연락 가능한 이메일 또는 주소, 처리 담당자 정보가 아직 운영자 확인을 필요로 합니다. 이 항목을 확정하고 문의 페이지 및 운영 환경 설정과 일치시킨 뒤 공개해야 합니다.\n\n## 9. 변경\n서비스 기능, 제공자, 데이터 처리 방식 또는 관련 법령이 변경되면 이 문서를 수정하고 시행일과 변경 내용을 표시합니다.'),
('terms','이용약관', E'# 이용약관\n시행일: 2026년 11월 14일\n\n## 제1조 목적과 서비스\n답지모음은 교재 정보 검색 및 외부 웹페이지 링크 안내 서비스입니다. 답지 파일 자체를 기본적으로 저장·판매·배포하지 않으며, 외부 자료의 공식성·정확성·이용 허락 여부를 보증하지 않습니다.\n\n## 제2조 이용자의 확인 의무\n이용자는 외부 페이지로 이동하기 전에 교재명, 출판사, 판본, 학년·학기, 자료의 내용 및 외부 사이트의 이용 조건을 직접 확인해야 합니다. 링크와 교재 정보는 변경·삭제될 수 있습니다.\n\n## 제3조 금지 행위\n이용자는 관련 법령 또는 제3자의 저작권·상표권·개인정보 등 권리를 침해하는 행위, 불법 자료의 복제·배포, 서비스에 대한 비정상적 대량 요청·침입·보안 우회, 허위 신고, 관리자 사칭 및 서비스 운영 방해 행위를 해서는 안 됩니다.\n\n## 제4조 이용자 제출\n교재 등록 요청과 링크 오류 신고는 검토를 위한 정보 제공이며, 제출만으로 교재 등록이나 링크 삭제가 보장되지 않습니다. 운영자는 중복·허위·불법 가능성·개인정보 노출 등을 검토해 처리할 수 있습니다.\n\n## 제5조 외부 링크\n외부 웹사이트의 콘텐츠, 보안, 광고, 개인정보 처리, 다운로드, 결제 및 이용 조건은 해당 운영자의 책임과 정책에 따릅니다. 링크 제공은 해당 사이트 또는 자료에 대한 보증이나 제휴를 의미하지 않습니다.\n\n## 제6조 지식재산권 및 신고\n서비스 자체의 화면과 콘텐츠의 권리는 해당 권리자에게 귀속됩니다. 교재·상표·표지·외부 저작물의 권리는 각 권리자에게 있습니다. 권리 침해가 의심되면 저작권 및 링크 정책에 따라 신고할 수 있습니다.\n\n## 제7조 서비스 변경 및 중단\n운영자는 유지보수, 보안, 법령 준수, 외부 제공자 장애 또는 기술적 사유로 서비스를 변경·제한·중단할 수 있습니다.\n\n## 제8조 책임 범위\n운영자의 고의 또는 과실에 따른 법령상 책임 등 강행법규상 배제할 수 없는 책임은 제외되지 않습니다. 그 밖의 책임 제한은 관련 법령이 허용하는 범위에서만 적용됩니다.\n\n## 제9조 개인정보\n개인정보 처리에 관한 사항은 별도의 개인정보처리방침에 따릅니다.\n\n## 제10조 준거법 및 분쟁\n본 약관은 대한민국 법령을 준거법으로 합니다. 분쟁은 관련 법령이 정하는 관할과 절차에 따릅니다.'),
('copyright','저작권 및 링크 정책', E'# 저작권 및 링크 정책\n\n## 외부 링크 원칙\n답지모음은 교재를 식별하고 외부 웹페이지로 연결하는 링크 정보를 제공합니다. 답지 파일을 직접 업로드·호스팅하거나 저작권자의 허락을 대신 확인하지 않습니다. 외부 링크가 있다는 이유만으로 자료가 합법적으로 게시되었거나 권리자가 허용했다는 의미는 아닙니다.\n\n## 권리 침해 신고\n권리자 또는 정당한 대리인은 다음 정보를 포함해 문의 및 오류 신고 경로로 신고할 수 있습니다.\n- 권리자 또는 대리인임을 확인할 수 있는 정보와 회신 연락처\n- 권리 대상 저작물 및 권리 관계 설명\n- 답지모음 교재 페이지 URL과 문제가 되는 외부 URL\n- 침해가 의심되는 구체적인 사유와 확인 가능한 자료\n- 신고 내용이 정확하다는 확인\n\n## 검토와 조치\n운영자는 신고의 구체성, 권리 관계 및 대상 링크를 검토하고 필요한 경우 해당 링크를 임시 비공개·삭제하거나 추가 자료를 요청할 수 있습니다. 신고만으로 위법성을 확정하지 않으며, 허위·악의적 신고는 별도 검토할 수 있습니다.\n\n## 링크 등록 기준\n교재명·출판사·판본·학년·학기 일치 여부, URL 안전성, 중복 여부 및 원본 페이지 접근 가능성을 확인하도록 노력합니다. 자동 검색 후보는 검토 전 공개 답지 링크로 취급하지 않습니다. 승인된 링크도 정확성이나 지속적인 접근 가능성을 보증하지 않습니다.'),
('contact','문의 및 오류 신고', E'# 문의 및 오류 신고\n\n## 교재 등록 요청\n사이트에 없는 교재는 화면의 교재 요청 기능으로 교재명과 출판사를 제출할 수 있습니다. 제출 내용은 관리자 접수함에 저장되며, 등록 여부는 검토 후 결정됩니다.\n\n## 답지 링크 오류 신고\n교재 상세 페이지에서 해당 링크의 오류 신고 기능을 이용하거나, 문제가 된 교재명·링크 URL·오류 사유를 구체적으로 알려 주세요.\n\n## 저작권 관련 신고\n권리자 또는 대리인은 저작권 및 링크 정책을 확인하고 권리 관계, 대상 URL, 침해 사유 및 회신 연락처를 제출해 주세요.\n\n## 운영자 연락처\n운영자가 실제로 확인하고 회신할 수 있는 이메일 주소를 배포 환경의 VITE_CONTACT_EMAIL에 설정하고, 개인정보처리방침의 책임자 정보와 일치시켜야 합니다. 현재 이메일이 설정되지 않은 경우 공개 전 반드시 설정해야 합니다.\n\n## 처리 안내\n접수는 검토를 보장하지만 즉시 등록·수정·삭제를 보장하지 않습니다. 가능한 경우 접수 상태를 관리자 화면에서 관리.')
on conflict (slug) do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='answer_link_search_runs') then
    alter publication supabase_realtime add table public.answer_link_search_runs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='answer_link_candidates') then
    alter publication supabase_realtime add table public.answer_link_candidates;
  end if;
end $$;
