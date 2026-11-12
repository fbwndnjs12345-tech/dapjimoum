from __future__ import annotations

import csv
import json
import math
import os
import sys
import queue
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
if getattr(sys, "frozen", False):
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(ROOT / "ms-playwright")
DEFAULT_CONFIG = ROOT / "sources.json"
OUTPUT = ROOT / "answer-link-candidates.csv"


def request_json(url: str, headers: dict[str, str], data: dict | None = None):
    payload = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST" if payload else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase 요청 실패 ({exc.code}): {detail[:500]}") from exc


class FinderApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("답지모음 · 로컬 링크 탐색기")
        root.geometry("900x720")
        root.minsize(760, 620)
        self.events: queue.Queue = queue.Queue()
        self.stop_event = None
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self.project_url: str = ''
        self.anon_key_value: str = ''
        self.books_path = tk.StringVar()
        self.supabase_url = tk.StringVar()
        self.anon_key = tk.StringVar()
        self.email = tk.StringVar()
        self.password = tk.StringVar()
        self.status = tk.StringVar(value="Supabase에서 교재를 불러오거나 CSV 파일을 선택하세요.")
        self.headed = tk.BooleanVar(value=True)
        self.max_pages = tk.StringVar(value="500")
        self.auto_upload = tk.BooleanVar(value=True)
        self._build()
        self.root.after(150, self._poll)

    def _build(self):
        self.root.configure(bg="#f5f7fa")
        style = ttk.Style()
        try:
            style.theme_use("vista")
        except tk.TclError:
            style.theme_use("clam")
        style.configure("TFrame", background="#f5f7fa")
        style.configure("Card.TLabelframe", background="#ffffff", bordercolor="#e2e8f0", relief="solid")
        style.configure("Card.TLabelframe.Label", background="#ffffff", foreground="#1f2937", font=("Malgun Gothic", 10, "bold"))
        style.configure("TLabel", background="#f5f7fa", foreground="#334155", font=("Malgun Gothic", 9))
        style.configure("Title.TLabel", background="#f5f7fa", foreground="#111827", font=("Malgun Gothic", 19, "bold"))
        style.configure("Sub.TLabel", background="#f5f7fa", foreground="#64748b", font=("Malgun Gothic", 9))
        style.configure("TButton", font=("Malgun Gothic", 9), padding=(12, 7))
        style.configure("Accent.TButton", font=("Malgun Gothic", 10, "bold"), padding=(16, 9))
        style.configure("TNotebook", background="#f5f7fa", borderwidth=0)
        style.configure("TNotebook.Tab", padding=(18, 10), font=("Malgun Gothic", 9, "bold"))
        style.configure("Treeview", rowheight=27, font=("Malgun Gothic", 9))
        style.configure("Treeview.Heading", font=("Malgun Gothic", 9, "bold"))

        outer = ttk.Frame(self.root, padding=(22, 18))
        outer.pack(fill="both", expand=True)
        header = ttk.Frame(outer)
        header.pack(fill="x", pady=(0, 15))
        ttk.Label(header, text="답지모음 로컬 탐색기", style="Title.TLabel").pack(anchor="w")
        ttk.Label(header, text="출판사 공식 공개 자료실에서 답지 링크 후보를 찾고, 관리자 검수 대기 목록으로 전달합니다.", style="Sub.TLabel").pack(anchor="w", pady=(4, 0))

        self.tabs = ttk.Notebook(outer)
        self.tabs.pack(fill="both", expand=True)
        account = ttk.Frame(self.tabs, padding=16)
        sources = ttk.Frame(self.tabs, padding=16)
        search = ttk.Frame(self.tabs, padding=16)
        self.tabs.add(account, text="① 교재 및 연결")
        self.tabs.add(sources, text="② 출처 설정")
        self.tabs.add(search, text="③ 탐색 및 결과")

        supa = ttk.LabelFrame(account, text="Supabase 관리자 연결 (선택)", style="Card.TLabelframe", padding=14)
        supa.pack(fill="x", pady=(0, 12))
        self._entry(supa, "프로젝트 URL", self.supabase_url, 0)
        self._entry(supa, "Anon / Publishable Key", self.anon_key, 1)
        self._entry(supa, "관리자 이메일", self.email, 2)
        self._entry(supa, "관리자 비밀번호", self.password, 3, show="•")
        row = ttk.Frame(supa)
        row.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(10, 0))
        ttk.Button(row, text="로그인 및 교재 가져오기", command=self.fetch_books, style="Accent.TButton").pack(side="left")
        ttk.Button(row, text="검색 후보 사이트 등록", command=self.upload_candidates).pack(side="left", padx=8)
        ttk.Label(supa, text="비밀번호는 파일에 저장하지 않습니다. 관리자 계정 권한이 필요합니다.", style="Sub.TLabel").grid(row=5, column=0, columnspan=3, sticky="w", pady=(8, 0))

        csvbox = ttk.LabelFrame(account, text="교재 CSV 직접 선택", style="Card.TLabelframe", padding=14)
        csvbox.pack(fill="x")
        ttk.Label(csvbox, text="필수 열: title 또는 교재명. 사이트 등록 시에는 각 행의 id도 필요합니다.").pack(anchor="w", pady=(0, 8))
        csvrow = ttk.Frame(csvbox)
        csvrow.pack(fill="x")
        ttk.Entry(csvrow, textvariable=self.books_path).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(csvrow, text="CSV 찾아보기", command=self.choose_csv).pack(side="left")

        sourcecard = ttk.LabelFrame(sources, text="공식 자료실 및 공개 웹 검색", style="Card.TLabelframe", padding=14)
        sourcecard.pack(fill="both", expand=True)
        ttk.Label(sourcecard, text="Google·Bing 공개 검색과 출판사 자료실을 함께 탐색합니다. 공개 웹 검색은 robots.txt 및 대상 사이트 정책을 준수합니다.", style="Sub.TLabel").pack(anchor="w")
        editor = ttk.Frame(sourcecard)
        editor.pack(fill="both", expand=True, pady=(10, 8))
        self.config_text = tk.Text(editor, height=16, wrap="none", font=("Consolas", 10), undo=True,
                                   bg="#ffffff", fg="#1f2937", insertbackground="#111827",
                                   relief="solid", bd=1, padx=10, pady=10)
        yscroll = ttk.Scrollbar(editor, orient="vertical", command=self.config_text.yview)
        xscroll = ttk.Scrollbar(sourcecard, orient="horizontal", command=self.config_text.xview)
        self.config_text.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        self.config_text.pack(side="left", fill="both", expand=True)
        yscroll.pack(side="right", fill="y")
        xscroll.pack(fill="x")
        if DEFAULT_CONFIG.exists():
            self.config_text.insert("1.0", DEFAULT_CONFIG.read_text(encoding="utf-8"))
        else:
            example = ROOT / "sources.example.json"
            if example.exists():
                self.config_text.insert("1.0", example.read_text(encoding="utf-8"))
            else:
                self.config_text.insert("1.0", json.dumps({"sources": [], "max_sitemap_urls_per_source": 500, "request_delay_seconds": 1.5, "page_timeout_ms": 20000, "answer_keywords": ["정답과 해설", "정답 해설", "답지"]}, ensure_ascii=False, indent=2))
        cfgbuttons = ttk.Frame(sourcecard)
        cfgbuttons.pack(fill="x")
        ttk.Button(cfgbuttons, text="설정 저장 및 검사", command=self.save_config, style="Accent.TButton").pack(side="left")
        ttk.Button(cfgbuttons, text="설정 예시 보기", command=lambda: webbrowser.open(str(ROOT / "README.md"))).pack(side="left", padx=8)

        runbox = ttk.LabelFrame(search, text="탐색 실행", style="Card.TLabelframe", padding=14)
        runbox.pack(fill="x", pady=(0, 12))
        ttk.Label(runbox, text="교재 CSV와 출처 설정을 준비한 뒤 탐색을 시작하세요.").pack(anchor="w", pady=(0, 10))
        options = ttk.Frame(runbox)
        options.pack(fill="x")
        ttk.Label(options, text="출처별 최대 페이지").pack(side="left")
        ttk.Entry(options, textvariable=self.max_pages, width=8).pack(side="left", padx=(8, 16))
        ttk.Checkbutton(options, text="브라우저 창 표시 (Google 직접 인증)", variable=self.headed).pack(side="left")
        ttk.Checkbutton(runbox, text="검색이 끝나면 Supabase에 자동 업로드 (로그인 필요 · 검수 대기 상태로만 저장)", variable=self.auto_upload).pack(anchor="w", pady=(8, 0))
        self.run_button = ttk.Button(options, text="탐색 시작", command=self.run_finder, style="Accent.TButton")
        self.run_button.pack(side="right")
        self.stop_button = ttk.Button(options, text="중지 및 결과 저장", command=self.stop_finder, state="disabled")
        self.stop_button.pack(side="right", padx=8)
        ttk.Button(options, text="결과 CSV 열기", command=self.open_output).pack(side="right", padx=8)

        self.progress = ttk.Progressbar(search, mode="indeterminate")
        self.progress.pack(fill="x", pady=(0, 10))
        preview = ttk.LabelFrame(search, text="후보 미리보기", style="Card.TLabelframe", padding=10)
        preview.pack(fill="both", expand=True, pady=(0, 10))
        columns = ("book", "candidate", "status", "score", "url")
        self.results = ttk.Treeview(preview, columns=columns, show="headings", height=6)
        for column, label, width in (("book", "교재", 210), ("candidate", "후보 페이지", 250), ("status", "판정", 90), ("score", "점수", 70), ("url", "후보 주소 (더블클릭해 열기)", 360)):
            self.results.heading(column, text=label)
            self.results.column(column, width=width, anchor="w" if column in ("book", "candidate") else "center")
        result_scroll = ttk.Scrollbar(preview, orient="vertical", command=self.results.yview)
        self.results.configure(yscrollcommand=result_scroll.set)
        self.results.pack(side="left", fill="both", expand=True)
        self.results.bind("<Double-1>", self.open_selected_result)
        result_scroll.pack(side="right", fill="y")

        logcard = ttk.LabelFrame(search, text="진행 상황 및 로그", style="Card.TLabelframe", padding=10)
        logcard.pack(fill="both", expand=True)
        self.log = tk.Text(logcard, height=7, state="disabled", wrap="word", font=("Malgun Gothic", 9),
                           bg="#ffffff", fg="#334155", relief="solid", bd=1, padx=10, pady=8)
        self.log.pack(fill="both", expand=True)

        footer = ttk.Frame(outer)
        footer.pack(fill="x", pady=(12, 0))
        self.status_label = ttk.Label(footer, textvariable=self.status, style="Sub.TLabel", wraplength=900)
        self.status_label.pack(anchor="w")

    def _entry(self, parent, label, variable, row, show=None):
        ttk.Label(parent, text=label, width=22).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=variable, show=show or "").grid(row=row, column=1, columnspan=2, sticky="ew", pady=3)
        parent.columnconfigure(1, weight=1)

    def log_line(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _poll(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self.log_line(value)
                elif kind == "status":
                    self.status.set(value)
                elif kind == "clear_password":
                    self.password.set("")
                elif kind == "books_path":
                    self.books_path.set(value)
                elif kind == "paused":
                    self.run_button.configure(state="normal")
                    self.stop_button.configure(state="disabled")
                    self.progress.stop()
                    self.status.set(value)
                    self.load_results()
                    messagebox.showwarning("검색 중지", value)
                elif kind == "done":
                    self.stop_button.configure(state="disabled")
                    self.run_button.configure(state="normal")
                    if hasattr(self, "progress"):
                        self.progress.stop()
                    self.status.set(value)
                    self.load_results()
                    messagebox.showinfo("완료", value)
                elif kind == "error":
                    self.stop_button.configure(state="disabled")
                    self.run_button.configure(state="normal")
                    if hasattr(self, "progress"):
                        self.progress.stop()
                    self.status.set("오류가 발생했습니다. 로그와 입력 설정을 확인하세요.")
                    self.log_line("[오류] " + value)
                    messagebox.showerror("오류", value)
        except queue.Empty:
            pass
        self.root.after(150, self._poll)

    def choose_csv(self):
        path = filedialog.askopenfilename(filetypes=[("CSV files", "*.csv"), ("All files", "*.*")])
        if path:
            self.books_path.set(path)

    def save_config(self):
        try:
            config = json.loads(self.config_text.get("1.0", "end"))
            sources = config.get("sources", [])
            web_cfg = config.get("web_search", {})
            web_enabled = bool(web_cfg.get("enabled", True))
            if not isinstance(sources, list):
                raise ValueError("sources는 배열이어야 합니다.")
            if not sources and not web_enabled:
                raise ValueError("공식 자료실 또는 공개 웹 검색 중 하나 이상 활성화하세요.")
            engines = web_cfg.get("engines", ["google", "bing"])
            if web_enabled and (not isinstance(engines, list) or not engines or any(x not in ("google", "bing") for x in engines)):
                raise ValueError("web_search.engines에는 google 또는 bing을 하나 이상 지정하세요.")
            results_per_engine = int(web_cfg.get("results_per_engine", 8))
            if results_per_engine < 1 or results_per_engine > 20:
                raise ValueError("검색엔진별 결과 수는 1~20 사이여야 합니다.")
            max_queries = int(web_cfg.get("max_queries_per_book", 8))
            if max_queries < 1 or max_queries > 10:
                raise ValueError("교재별 검색어 수는 1~10 사이여야 합니다.")
            seen = set()
            for index, source in enumerate(sources, 1):
                if not isinstance(source, dict):
                    raise ValueError(f"{index}번째 출처 형식이 올바르지 않습니다.")
                publisher = str(source.get("publisher") or "").strip()
                urls = source.get("start_urls")
                if not publisher or not isinstance(urls, list) or not urls:
                    raise ValueError(f"{index}번째 출처에 publisher와 start_urls가 필요합니다.")
                for raw_url in urls:
                    parsed = urllib.parse.urlparse(str(raw_url).strip())
                    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                        raise ValueError(f"올바르지 않은 HTTP(S) 자료실 주소: {raw_url}")
                    normalized = parsed.geturl().rstrip("/")
                    if normalized in seen:
                        raise ValueError(f"중복된 자료실 주소: {normalized}")
                    seen.add(normalized)
            delay = float(config.get("request_delay_seconds", 1.5))
            timeout = int(config.get("page_timeout_ms", 20000))
            pages = int(config.get("max_sitemap_urls_per_source", 500))
            terms = config.get("answer_keywords")
            if not math.isfinite(delay) or delay < 1 or timeout < 1000 or pages < 1:
                raise ValueError("요청 간격은 1초 이상, 페이지 시간 제한은 1000ms 이상, 최대 페이지는 1 이상이어야 합니다.")
            if not isinstance(terms, list) or not terms or any(not isinstance(term, str) or not term.strip() for term in terms):
                raise ValueError("answer_keywords는 비어 있지 않은 문자열 배열이어야 합니다.")
            DEFAULT_CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            self.events.put(("status", f"설정 검사 및 저장 완료: 공식 출처 {len(sources)}곳 · 공개 웹 검색 {'활성화' if web_enabled else '비활성화'}"))
            return True
        except Exception as exc:
            messagebox.showerror("설정 오류", str(exc))
            return False

    def fetch_books(self):
        base = self.supabase_url.get().strip().rstrip("/")
        key = self.anon_key.get().strip()
        email = self.email.get().strip()
        password = self.password.get()
        def worker():
            try:
                if not all([base, key, email, password]):
                    self.events.put(("log", "[안내] Supabase 미연결: 로컬 CSV 탐색은 가능하며, 사이트 업로드만 비활성화됩니다."))
                    self.events.put(("status", "로컬 CSV 탐색 모드 · Supabase 업로드를 사용하려면 관리자 로그인이 필요합니다."))
                    return
                auth = request_json(base + "/auth/v1/token?grant_type=password",
                    {"apikey": key, "Content-Type": "application/json"}, {"email": email, "password": password})
                token = auth.get("access_token")
                self.access_token = token
                self.refresh_token = auth.get("refresh_token")
                self.project_url = base
                self.anon_key_value = key
                if not token:
                    raise RuntimeError("로그인 응답에 access_token이 없습니다.")
                rows, offset, limit = [], 0, 1000
                while True:
                    query = urllib.parse.urlencode({"select": "id,title,publisher,subject,grade,semester,series", "order": "title.asc", "limit": str(limit), "offset": str(offset)})
                    data = request_json(base + "/rest/v1/books?" + query,
                        {"apikey": key, "Authorization": "Bearer " + token, "Accept": "application/json"})
                    if not isinstance(data, list):
                        raise RuntimeError("교재 목록 응답 형식이 올바르지 않습니다.")
                    rows.extend(data)
                    self.events.put(("log", f"교재 {len(rows)}권 불러옴"))
                    if len(data) < limit:
                        break
                    offset += limit
                if not rows:
                    raise RuntimeError("교재가 0권 조회됐습니다. 관리자 계정의 books 읽기 권한과 Supabase URL을 확인하세요.")
                path = ROOT / "books.csv"
                fields = ["id", "title", "publisher", "subject", "grade", "semester", "series"]
                with path.open("w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.DictWriter(f, fieldnames=fields)
                    writer.writeheader()
                    writer.writerows(rows)
                self.events.put(("books_path", str(path)))
                self.events.put(("clear_password", ""))
                self.events.put(("status", f"교재 {len(rows)}권 저장 완료: {path}"))
            except Exception as exc:
                self.events.put(("error", str(exc)))
        threading.Thread(target=worker, daemon=True).start()

    def run_finder(self):
        csv_path = Path(self.books_path.get().strip())
        if not csv_path.is_file():
            messagebox.showerror("CSV 필요", "먼저 교재 CSV 파일을 선택하거나 Supabase에서 불러오세요.")
            return
        try:
            config = json.loads(self.config_text.get("1.0", "end"))
            if not config.get("sources") and not config.get("web_search", {}).get("enabled", True):
                raise ValueError("공식 자료실 또는 공개 웹 검색 중 하나 이상 활성화하세요.")
            if not self.save_config():
                return
            max_pages = int(self.max_pages.get())
            if max_pages < 1:
                raise ValueError("최대 페이지는 1 이상이어야 합니다.")
        except Exception as exc:
            messagebox.showerror("설정 확인", str(exc))
            return
        headed = self.headed.get()
        self.run_button.configure(state="disabled")
        self.stop_event = threading.Event()
        self.stop_button.configure(state="normal")
        self.status.set("탐색 중입니다. 검색엔진과 대상 사이트의 접근 정책을 확인하며 진행합니다.")
        self.tabs.select(2)
        self.progress.start(12)
        self.log_line("[시작] 탐색 작업을 준비합니다.")
        auto_upload = self.auto_upload.get()
        def worker():
            try:
                from finder import run_search
                count = run_search(csv_path, OUTPUT, DEFAULT_CONFIG, headed, max_pages,
                                   lambda line: self.events.put(("log", line)), self.stop_event)
                stopped = self.stop_event.is_set()
                upload_summary = ""
                if auto_upload and self.access_token and self.project_url and self.anon_key_value:
                    self.events.put(("status", "검색 결과를 저장했습니다. Supabase에 후보를 자동 등록하는 중입니다."))
                    inserted, duplicates = self._upload_candidate_file()
                    upload_summary = f"\nSupabase 업로드: 신규 {inserted}개 · 중복 {duplicates}개 (모두 관리자 검수 대기)"
                elif auto_upload:
                    upload_summary = "\nSupabase 자동 업로드는 로그인되지 않아 건너뛰었습니다. CSV는 저장되었습니다."
                if stopped:
                    self.events.put(("paused", f"검색을 중지했습니다. 후보 {count}개를 CSV에 저장했습니다.\n저장 위치: {OUTPUT}{upload_summary}"))
                else:
                    self.events.put(("done", f"탐색 완료: 후보 {count}개\n저장 위치: {OUTPUT}{upload_summary}"))
            except Exception as exc:
                self.events.put(("error", f"{exc}\n검색 CSV는 유지됩니다. 업로드가 일부 진행된 경우 같은 CSV를 다시 업로드해도 중복은 건너뜁니다."))
        threading.Thread(target=worker, daemon=True).start())


    def stop_finder(self):
        if self.stop_event is not None and not self.stop_event.is_set():
            self.stop_event.set()
            self.stop_button.configure(state="disabled")
            self.status.set("중지 요청을 보냈습니다. 현재 페이지 요청이 끝나면 후보를 저장하고 알림을 표시합니다.")
            self.log_line("[중지 요청] 현재 처리 중인 요청이 끝나는 대로 검색을 멈춥니다.")

    def _refresh_access_token(self):
        if not self.refresh_token:
            raise RuntimeError("로그인 토큰이 만료되었습니다. Supabase에 다시 로그인하세요.")
        auth = request_json(
            self.project_url + "/auth/v1/token?grant_type=refresh_token",
            {"apikey": self.anon_key_value, "Content-Type": "application/json"},
            {"refresh_token": self.refresh_token},
        )
        if not auth.get("access_token"):
            raise RuntimeError("Supabase 세션 갱신에 실패했습니다. 다시 로그인하세요.")
        self.access_token = auth["access_token"]
        self.refresh_token = auth.get("refresh_token", self.refresh_token)

    def _upload_candidate_file(self):
        if not self.access_token or not self.project_url or not self.anon_key_value:
            raise RuntimeError("Supabase 로그인이 필요합니다.")
        if not OUTPUT.is_file():
            raise RuntimeError("업로드할 후보 CSV가 없습니다.")
        with OUTPUT.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        if not rows:
            return 0, 0
        invalid = [index + 2 for index, row in enumerate(rows) if not row.get("book_id") or not row.get("url")]
        if invalid:
            preview = ", ".join(map(str, invalid[:10]))
            suffix = " 외" if len(invalid) > 10 else ""
            raise RuntimeError(f"CSV {len(invalid)}개 행에 교재 ID 또는 URL이 없습니다. 누락 행: {preview}{suffix}. 교재 ID가 포함된 Supabase 교재 CSV를 사용하세요.")
        endpoint = self.project_url + "/functions/v1/answer-link-import-candidates"
        inserted = duplicates = sent = 0
        for start in range(0, len(rows), 100):
            batch = []
            for row in rows[start:start + 100]:
                batch.append({
                    "book_id": row["book_id"],
                    "title": row.get("candidate_title") or row.get("source_name") or "답지 후보",
                    "url": row["url"],
                    "snippet": row.get("snippet", ""),
                    "match_status": row.get("match_status", "uncertain"),
                    "link_type": row.get("link_type", "웹페이지"),
                    "source_type": "official" if row.get("source_type") == "publisher" else "general",
                    "query": row.get("search_query") or "local-search",
                })
            headers = {
                "apikey": self.anon_key_value,
                "Authorization": "Bearer " + self.access_token,
                "Content-Type": "application/json",
            }
            try:
                result = request_json(endpoint, headers, {"candidates": batch})
            except RuntimeError as exc:
                if "요청 실패 (401)" not in str(exc):
                    raise
                self._refresh_access_token()
                headers["Authorization"] = "Bearer " + self.access_token
                result = request_json(endpoint, headers, {"candidates": batch})
            inserted += int(result.get("inserted", 0))
            duplicates += int(result.get("duplicates", 0))
            sent += len(batch)
            self.events.put(("log", f"[Supabase 업로드] {sent}/{len(rows)}개 처리 · 신규 {inserted} · 중복 {duplicates}"))
        return inserted, duplicates

    def upload_candidates(self):
        if not self.access_token or not self.project_url or not self.anon_key_value:
            messagebox.showerror("로그인 필요", "먼저 Supabase URL, anon/publishable key, 관리자 이메일과 비밀번호로 로그인하세요.")
            return
        if not OUTPUT.is_file():
            messagebox.showerror("결과 없음", "먼저 후보 탐색을 실행하세요.")
            return
        if not messagebox.askyesno("후보 등록", "검색 후보를 Supabase 관리자 검수 대기 목록에 등록합니다. 자동 승인되지는 않습니다. 계속할까요?"):
            return
        def worker():
            try:
                inserted, duplicates = self._upload_candidate_file()
                self.events.put(("done", f"Supabase 등록 완료: 신규 후보 {inserted}개, 기존 중복 {duplicates}개. 모두 관리자 검수 대기 상태입니다."))
            except Exception as exc:
                self.events.put(("error", str(exc)))
        threading.Thread(target=worker, daemon=True).start()

    def load_results(self):
        if not hasattr(self, "results") or not OUTPUT.is_file():
            return
        for item in self.results.get_children():
            self.results.delete(item)
        try:
            with OUTPUT.open("r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            for row in rows[:500]:
                self.results.insert("", "end", values=(
                    row.get("book_title", ""),
                    row.get("candidate_title", ""),
                    row.get("match_status", ""),
                    row.get("match_score", ""),
                    row.get("url", ""),
                ))
            if len(rows) > 500:
                self.log_line(f"[안내] 후보 {len(rows)}개 중 처음 500개만 미리 표시합니다.")
        except Exception as exc:
            self.log_line(f"[결과 미리보기 오류] {exc}")

    def open_selected_result(self, event=None):
        selected = self.results.selection()
        if not selected:
            return
        values = self.results.item(selected[0], "values")
        if len(values) >= 5 and str(values[4]).startswith(("http://", "https://")):
            webbrowser.open(str(values[4]))

    def open_output(self):
        if OUTPUT.exists():
            webbrowser.open(str(OUTPUT))
        else:
            messagebox.showinfo("결과 없음", "아직 후보 CSV가 없습니다. 먼저 탐색을 실행하세요.")


def self_test():
    """Run dependency, configuration, Tk, and bundled Chromium smoke checks."""
    try:
        from finder import read_books, assess
        from playwright.sync_api import sync_playwright
        example = ROOT / "sources.example.json"
        config = json.loads(example.read_text(encoding="utf-8"))
        if not isinstance(config.get("sources"), list) or not config["sources"]:
            raise RuntimeError("예시 출처 설정이 비어 있습니다.")
        for source in config["sources"]:
            for url in source.get("start_urls", []):
                parsed = urllib.parse.urlparse(url)
                if parsed.scheme not in ("http", "https") or not parsed.hostname:
                    raise RuntimeError("예시 자료실 URL 형식이 올바르지 않습니다.")
        sample = {"title": "오투 중등 과학 2-1"}
        if assess(sample, "오투 중등 과학 2-1 정답과 해설", "정답과 해설", ["정답과 해설"])[1] != "likely":
            raise RuntimeError("후보 판정 자체 테스트 실패")
        root = tk.Tk()
        root.withdraw()
        FinderApp(root)
        root.update_idletasks()
        root.destroy()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_content("<html><head><title>DapjiMoum smoke test</title></head><body>OK</body></html>")
            if page.title() != "DapjiMoum smoke test":
                raise RuntimeError("Chromium 페이지 테스트 실패")
            browser.close()
        (ROOT / "self-test.log").write_text("SELF-TEST PASSED: config, matching, Tk, Playwright Chromium\\n", encoding="utf-8")
        return 0
    except Exception as exc:
        print(f"SELF-TEST FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        try:
            (ROOT / "self-test.log").write_text(f"SELF-TEST FAILED: {type(exc).__name__}: {exc}\\n", encoding="utf-8")
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        raise SystemExit(self_test())
    root = tk.Tk()
    FinderApp(root)
    root.mainloop()
