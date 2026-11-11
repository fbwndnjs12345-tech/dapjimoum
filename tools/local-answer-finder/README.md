# 로컬 답지 링크 후보 탐색기

검색 API를 사용하지 않고, **사용자 PC에서 실행**해 설정한 출판사 공식 사이트의 공개 페이지를 살펴보는 보조 도구입니다.

## 작동 방식

1. 관리자 페이지 등에서 교재 목록을 CSV로 내보냅니다.
2. `sources.json`에 탐색을 허용할 출판사 공식 사이트 주소를 넣습니다.
3. 프로그램이 각 사이트의 `robots.txt`와 공개 sitemap을 확인합니다.
4. robots 정책상 허용된 동일 사이트 페이지를 Playwright로 열어 제목·설명·본문을 확인합니다.
5. 교재명과 답지 관련 단어가 함께 나타나는 페이지를 후보 CSV로 저장합니다.
6. 현재 버전은 CSV 생성까지 지원합니다. **사이트 관리자 후보 테이블로 자동 전송하거나 자동 승인하지 않습니다.** 후보를 관리자 페이지에 넣는 연동은 별도 작업입니다.

## 설치

Python 3.10 이상을 설치한 뒤 이 폴더에서 실행합니다.

```bash
python -m venv .venv
# Windows
.venv\\Scripts\\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
python -m playwright install chromium
```

## 설정

`sources.example.json`을 복사해 `sources.json`으로 만들고 실제 출판사 공식 자료실 주소를 넣습니다.

```json
{
  "sources": [
    {
      "publisher": "출판사명",
      "start_urls": ["https://공식-도메인/자료실"]
    }
  ],
  "max_sitemap_urls_per_source": 500,
  "request_delay_seconds": 1.5,
  "page_timeout_ms": 20000,
  "answer_keywords": ["정답과 해설", "정답 해설", "답지"]
}
```

예시 설정에는 출처가 비어 있습니다. 실제로 공식 소유·운영 도메인인지 직접 확인한 주소만 추가하세요. 가능하면 홈페이지 전체보다 공식 자료실 URL을 지정하세요.

## 실행

CSV에는 최소한 `title` 열이 필요합니다. 선택 열은 `id`, `publisher`, `subject`, `grade`, `semester`, `series`입니다. 기존 Supabase `books.id`를 `id` 열로 함께 내보내면 결과 CSV에 `book_id`가 포함되어 추후 DB 연동에 사용할 수 있습니다. 한글 CSV(UTF-8 BOM 또는 CP949)를 지원합니다.

```bash
python finder.py --input books.csv --output candidates.csv --config sources.json
```

브라우저 창을 보면서 실행하려면:

```bash
python finder.py --input books.csv --output candidates.csv --config sources.json --headed
```

## 제한 및 안전

- Google·네이버 검색 결과 페이지를 자동으로 긁지 않습니다. 검색 API도 호출하지 않습니다.
- 설정한 출판사 도메인의 robots.txt와 sitemap에서 시작하며, robots 정책이 확인되지 않거나 크롤링이 금지된 페이지는 건너뜁니다.
- 로그인·유료·접근 제한 페이지, CAPTCHA, 차단을 우회하지 않습니다.
- sitemap에 없거나 검색엔진에만 노출된 페이지는 찾지 못할 수 있습니다.
- 이 도구는 후보 발굴기입니다. 제목이 비슷해도 실제 교재의 정답지인지 사람 검수가 필요합니다.
- 실행 중 요청 간격을 지키고, 페이지 수 제한을 낮게 시작하세요.

## 현재 버전의 범위

이 버전은 출판사 공식 사이트의 공개 sitemap 및 허용 페이지를 기반으로 후보를 CSV로 만드는 MVP입니다. 웹 전체를 검색하는 범용 검색 엔진이 아니며, 자료실이 sitemap에 포함되지 않으면 놓칠 수 있습니다. 관리자 페이지에 후보를 자동 등록하는 기능은 아직 포함하지 않았습니다.
