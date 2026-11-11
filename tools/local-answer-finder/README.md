# 답지모음 로컬 링크 탐색기 (Windows)

검색 API를 호출하지 않고 사용자 PC에서 실행하는 데스크톱 도구입니다. 교재 목록은 기존 Supabase `books` 테이블에서 관리자 로그인으로 가져오거나 CSV로 불러올 수 있습니다. 설정한 출판사 공식 사이트의 공개 페이지를 탐색하고 후보를 기존 사이트의 관리자 검수 대기 목록으로 보낼 수 있습니다.

> 범위: 이 프로그램은 Google·Naver 검색 결과를 자동 수집하지 않습니다. 검색엔진 결과를 무단으로 긁는 방식 대신, 사용자가 지정한 공식 출판사 도메인의 robots.txt와 공개 sitemap을 이용합니다. 따라서 웹 전체를 검색하는 범용 검색엔진과 같지는 않습니다.

## Windows에서 실행

1. Python 3.11 이상 설치: https://www.python.org/downloads/windows/
   - 설치 화면에서 **Add Python to PATH** 선택
2. GitHub에서 저장소 ZIP을 내려받고 압축을 풉니다.
3. 압축을 푼 폴더에서 `tools/local-answer-finder` 폴더로 들어갑니다.
4. `설치_및_실행.bat`을 더블클릭합니다.
5. 최초 실행 시 필요한 패키지와 Chromium을 자동 설치한 뒤 프로그램이 열립니다.
6. 다음 실행부터는 `프로그램_실행.bat`을 더블클릭합니다.

설치 중 인터넷 연결이 필요합니다. 프로그램 자체의 검색 API 비용은 없습니다. 사이트 탐색 시 출판사 서버에 요청을 보내므로 최소 1.5초 간격을 기본으로 둡니다.

## 프로그램 사용 순서

### 1. Supabase 연결 (권장)

프로그램 상단에 아래 값을 입력하고 **로그인 후 교재 CSV 저장**을 누릅니다.

- Supabase URL
- Supabase anon / publishable key
- 관리자 계정 이메일 및 비밀번호

이 값은 기존 웹 앱의 Supabase 프로젝트 설정과 같은 값입니다. URL과 공개 anon/publishable key는 프로젝트 설정에서 확인합니다. 비밀번호는 파일에 저장하지 않고 로그인 요청에만 사용하며, 로그인 후 입력 칸을 비웁니다. 로그인 토큰은 프로그램 메모리에만 유지됩니다.

로그인한 계정은 기존 프로젝트의 `admin_users`에 등록된 관리자여야 합니다. 관리자 권한이 없거나 `books` 테이블 읽기 정책이 없으면 교재 가져오기가 실패합니다.

### 2. 출판사 공식 자료실 설정

프로그램의 설정 칸에 출처를 추가한 뒤 **설정 저장**을 누릅니다. 또는 `sources.example.json`을 참고해 `sources.json`을 직접 만들 수 있습니다.

```json
{
  "sources": [
    {
      "publisher": "출판사명",
      "start_urls": ["https://출판사-공식-도메인/실제-자료실-주소"]
    }
  ],
  "max_sitemap_urls_per_source": 500,
  "request_delay_seconds": 1.5,
  "page_timeout_ms": 20000,
  "answer_keywords": ["정답과 해설", "정답 해설", "정답 및 해설", "답지"]
}
```

공식 사이트인지 직접 확인한 주소만 입력하세요. 주소를 임의로 추정해 넣지 마세요. 실제 자료실 주소를 지정하는 것이 홈페이지 전체를 지정하는 것보다 효율적입니다. robots.txt를 확인할 수 없거나 크롤링이 금지된 주소는 자동으로 건너뜁니다.

### 3. 탐색 실행

- Supabase에서 교재를 가져왔거나 `id,title,publisher,subject,grade,semester,series` 열이 있는 CSV를 선택합니다.
- 출처별 최대 페이지 수를 지정합니다.
- **탐색 시작**을 누릅니다.
- 결과는 `answer-link-candidates.csv`에 저장됩니다.

### 4. 기존 사이트 관리자 페이지에 후보 등록

Supabase 로그인 상태에서 **검색 후보를 사이트에 등록**을 누릅니다. 한 번에 100개씩 전송하며, 기존 `answer_link_candidates` 테이블의 중복 키를 기준으로 중복 입력을 방지합니다.

등록된 후보는 기존 관리자 링크 검색 화면의 검토 대기 목록에 나타납니다. **자동 승인되지 않습니다.** 관리자가 교재명·학년·학기·판본과 URL을 확인한 뒤 승인해야 실제 사이트에 답지 링크로 등록됩니다.

## Supabase Edge Function 배포 (최초 1회)

후보를 사이트에 전송하려면 이 저장소의 새 Edge Function을 프로젝트에 한 번 배포해야 합니다. Supabase CLI가 설치·로그인되어 있고 올바른 프로젝트에 연결된 상태에서 저장소 루트에서 실행합니다.

```bash
supabase functions deploy answer-link-import-candidates
```

이 함수는 로그인 토큰을 확인하고 `admin_users`에 등록된 관리자만 후보를 저장하도록 제한합니다. service role key는 서버 환경에서만 사용하며 데스크톱 프로그램에 입력하거나 저장하지 않습니다. 기존 `answer_link_candidates` 테이블을 만드는 migration도 해당 Supabase 프로젝트에 적용되어 있어야 합니다.

## 입력 CSV 형식

필수: `title` 또는 `교재명`

선택: `id`, `publisher`, `subject`, `grade`, `semester`, `series`

후보를 Supabase에 등록하려면 기존 `books.id` 값이 반드시 필요합니다. 프로그램의 Supabase 가져오기 기능을 쓰면 이 값이 자동 포함됩니다.

## 안전 및 제한

- Google·네이버 검색 결과 페이지를 스크래핑하지 않습니다.
- 로그인·유료·접근 제한 페이지, CAPTCHA, 차단을 우회하지 않습니다.
- 설정된 동일 도메인과 robots.txt에서 허용한 공개 페이지만 방문합니다.
- sitemap에 없는 페이지는 놓칠 수 있습니다.
- 일부 사이트는 robots.txt 또는 sitemap을 제공하지 않아 탐색되지 않을 수 있습니다.
- 제목/설명 일치 점수는 자동 판정 보조일 뿐입니다. 실제 답지·판본·학년 일치는 관리자가 확인해야 합니다.
- 출처 유형은 자동으로 공식 인증하지 않고 `unknown`으로 저장합니다.
- PDF 링크는 다운로드를 시도하지 않고 링크 후보로 기록합니다.
- 검색 결과 수나 후보 수를 보장하지 않습니다.

## 문제 해결

- Python을 찾지 못하면 Python 설치 시 PATH 옵션을 켜고 다시 실행합니다.
- Chromium 오류가 나면 `프로그램_실행.bat` 대신 `설치_및_실행.bat`을 다시 실행합니다.
- 교재 목록이 0권이면 Supabase URL/키, 관리자 로그인, `books` 테이블 RLS를 확인합니다.
- 후보 등록에서 404가 나오면 Supabase 프로젝트에 `answer-link-import-candidates` Edge Function이 배포되었는지 확인합니다.
- 401/403이면 로그인 세션과 `admin_users` 관리자 등록 여부를 확인합니다.
