# 답지모음 로컬 링크 탐색기 (Windows)

Windows용 데스크톱 프로그램입니다. 교재명으로 Google 및 Bing의 일반 공개 검색 결과를 조회하고, 설정된 출판사 공식 자료실의 공개 페이지와 사이트맵도 함께 탐색해 답지 링크 후보를 수집합니다. 별도 검색 API 키는 필요하지 않습니다.

## 다운로드 및 실행

1. GitHub 저장소의 Actions 탭에서 최신 Build local answer finder 실행을 엽니다.
2. 실행 결과가 성공이면 Artifacts에서 답지모음-로컬-탐색기-Windows를 다운로드합니다.
3. ZIP을 압축 해제합니다.
4. 폴더 안의 DapjiMoumFinder.exe를 실행합니다.

이 패키지는 Python, 라이브러리, Playwright Chromium을 함께 포함하므로 별도 Python 설치나 BAT 실행이 필요하지 않습니다.

**스마트 앱 컨트롤 관련 주의:** 서명되지 않은 실행 파일은 스마트 앱 컨트롤이 차단할 수 있습니다. EXE 패키징만으로 차단 해제가 보장되지는 않습니다. 현재 빌드에는 코드 서명 인증서가 없습니다. 스마트 앱 컨트롤을 끄거나 우회하지 마세요.

## 사용 순서

1. 선택적으로 Supabase URL, anon/publishable key, 관리자 이메일과 비밀번호를 입력하고 로그인 후 교재 CSV를 저장합니다. 비밀번호는 파일에 저장하지 않습니다.
2. Supabase에서 가져오거나 id,title,publisher,subject,grade,semester,series 열이 있는 CSV를 선택합니다.
3. 출처 설정 JSON에서 `web_search.enabled`를 true로 두면 Google 및 Bing 공개 검색을 사용합니다. 기본값은 두 검색엔진 모두 활성화입니다.
4. 공식 자료실도 탐색하려면 `sources` 배열에 출판사명과 자료실 주소를 추가합니다. 공개 웹 검색만 사용할 경우 `sources`를 빈 배열로 둘 수 있습니다.
5. Supabase 로그인 상태라면 `검색이 끝나면 Supabase에 자동 업로드`가 기본으로 켜져 있습니다. 탐색 종료 또는 중지 후 결과 CSV를 100개씩 나누어 `answer-link-import-candidates` Edge Function으로 전송합니다. 로그인하지 않았다면 CSV만 저장되고 자동 업로드는 건너뜁니다.
6. 업로드 결과는 `answer_link_candidates` 테이블의 `pending`(관리자 검수 대기) 상태로 저장됩니다. 중복 URL은 `book_id + url_identity` 기준으로 건너뛰므로 같은 CSV를 다시 올려도 후보가 중복 생성되지 않습니다.
7. 관리자 페이지에서 후보를 검수해 승인해야 `answer_links`에 반영되어 사이트 이용자에게 노출됩니다. 자동 승인·자동 게시하지 않습니다.

## Supabase 업로드 구조

- 프로그램은 Supabase Auth의 이메일/비밀번호 로그인으로 사용자 Access Token과 Refresh Token을 메모리에 받습니다. 비밀번호와 토큰은 설정 파일이나 CSV에 기록하지 않습니다.
- 교재는 `public.books`에서 페이지 단위로 읽어 `books.csv`로 저장합니다. 현재 연결된 프로젝트에는 교재 1,762권이 있습니다.
- 후보 등록은 `POST /functions/v1/answer-link-import-candidates`로 전송하며, 100개 단위 배치와 만료 시 Refresh Token 갱신 후 재시도를 지원합니다.
- Edge Function은 JWT를 검증하고 `public.admin_users`에 등록된 관리자만 허용합니다. `service_role` 키는 Edge Function 서버 환경에서만 사용하고 로컬 EXE에 넣지 않습니다.
- 서버는 후보를 `pending` 상태로만 저장합니다. `answer_links`에 직접 쓰지 않으므로 검수 전에는 공개 답지 링크로 노출되지 않습니다.
- 신규/중복 개수를 프로그램 로그와 완료 알림에 표시합니다. 일부 배치 실패 시 CSV가 보존되며 재업로드는 URL 고유키로 중복을 방지합니다.

후보 등록을 위해 저장소 루트에서 최초 1회 다음 Edge Function을 올바른 Supabase 프로젝트에 배포해야 합니다:

```bash
supabase functions deploy answer-link-import-candidates
```

## 검색 범위 및 제한

- Google 및 Bing에서 교재별 최대 8가지 검색어(교재명, 정답/답지, 시리즈·학년·학기, 블로그 플랫폼)를 사용합니다. 기본 검색 결과 수는 엔진별 검색어당 최대 12개입니다.
- 티스토리와 네이버 블로그 등 공개 블로그 플랫폼을 겨냥한 검색어도 포함합니다. 검색엔진 색인 범위에 따라 누락될 수 있습니다.
- 후보는 교재명 토큰, 시리즈, 과목, 학년·학기, 정답 관련 문구를 종합 평가하며 다른 학기·학년이 명확하면 제외합니다. 점수는 자동 확정이 아니라 검수 우선순위입니다.
- Google이 CAPTCHA를 표시하면 브라우저 창을 열어 사용자가 직접 인증할 수 있습니다. 기본 설정은 브라우저 창 표시이며, 인증이 끝나면 제한 시간 안에서 현재 검색을 이어갑니다.
- Google이 계속 접근을 거부하거나 제한 시간이 끝나면 Google 검색만 중단하고 Bing 검색은 계속합니다. CAPTCHA·차단을 자동으로 풀거나 우회하지 않습니다.
- 검색 결과에서 발견한 각 사이트의 `robots.txt`를 확인합니다. robots.txt를 읽을 수 없거나 접근이 금지된 URL은 건너뜁니다.
- 로그인, 유료 페이지, CAPTCHA, 접근 차단을 우회하지 않습니다.
- 검색 결과는 후보일 뿐 실제 정답 자료인지 자동 확정하지 않습니다. 관리자 검수가 필요합니다.
- URL 안전 검사에서 file:, javascript:, localhost, 사설 IP, 자격 증명이 포함된 URL은 제외합니다. 블로그 출처 판정은 정확한 도메인 경계로 검사합니다.
- PDF는 현재 다운로드·본문 검증하지 않으므로 검색 제목과 요약만으로 likely 판정을 받지 않습니다. 후보는 uncertain으로 내려 관리자 확인이 필요합니다.
- 결과 수와 검색엔진 가용성을 보장하지 않습니다.
