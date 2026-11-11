# 답지모음 로컬 링크 탐색기 (Windows)

Windows용 데스크톱 프로그램입니다. 검색 API 없이 사용자가 지정한 출판사 공식 사이트의 robots.txt와 공개 sitemap을 확인해 답지 링크 후보를 수집합니다.

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
3. 프로그램의 설정 JSON에 실제로 확인한 출판사 공식 자료실 주소를 입력하고 설정 저장을 누릅니다. sources.example.json을 참고하세요.
4. 탐색 시작을 누르면 answer-link-candidates.csv에 결과가 저장됩니다.
5. Supabase 로그인 상태에서 검색 후보를 사이트에 등록을 누르면 관리자 검수 대기 목록에 등록됩니다. 후보는 자동 승인되지 않습니다.

후보 등록을 위해 저장소 루트에서 최초 1회 다음 Edge Function을 올바른 Supabase 프로젝트에 배포해야 합니다:

```bash
supabase functions deploy answer-link-import-candidates
```

## 검색 범위 및 제한

- Google·Naver 검색 결과를 스크래핑하지 않습니다.
- 로그인, 유료 페이지, CAPTCHA, 차단을 우회하지 않습니다.
- 설정된 공식 도메인의 robots.txt에서 허용한 공개 페이지와 sitemap만 확인합니다.
- sitemap이 없거나 robots.txt를 확인할 수 없는 사이트는 건너뜁니다.
- 검색 결과와 후보 수를 보장하지 않습니다.
- 출처 유형은 자동 인증하지 않고 unknown으로 저장합니다.
- PDF는 다운로드하지 않고 링크 후보로 기록합니다.
