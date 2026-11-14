from __future__ import annotations

import csv
import datetime
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
# Keep writable user data out of the installation directory. Windows commonly
# installs or extracts applications under locations where normal users cannot
# write (for example Program Files or a protected Downloads folder).
def _user_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "DapjiMoum" / "LocalAnswerFinder"
    return Path.home() / "AppData" / "Local" / "DapjiMoum" / "LocalAnswerFinder"


DATA_DIR = _user_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_CONFIG = DATA_DIR / "sources.json"
OUTPUT = DATA_DIR / "answer-link-candidates.csv"
BOOKS_CSV = DATA_DIR / "books.csv"
SELF_TEST_LOG = ROOT / "self-test.log"  # CI reads this file beside the packaged test executable.


def request_json(url: str, headers: dict[str, str], data: dict | None = None):
    payload = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST" if payload else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            try:
                return json.loads(raw)
            except json.JSONDecodeError as exc:
                raise RuntimeError("Supabase 응답을 JSON으로 읽지 못했습니다. 프로젝트 URL과 네트워크 연결을 확인하세요.") from exc
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase 요청 실패 ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        reason = getattr(exc, "reason", exc)
        raise RuntimeError(f"네트워크 연결 실패: {reason}. 인터넷 연결과 방화벽 설정을 확인하세요.") from exc


class FinderApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("답지모음 · 로컬 링크 탐색기")
        root.geometry("900x720")
        root.minsize(760, 620)
        self.events: queue.Queue = queue.Queue()
        self.stop_event = None
        self.access_token: str | None = None
        self.project_url: str = ''
        self.anon_key_value: str = ''
        self.books_path = tk.StringVar()
        self.supabase_url = tk.StringVar()
        self.anon_key = tk.StringVar()
        self.email = tk.StringVar()
        self.password = tk.StringVar()
        self.status = tk.StringVar(value="Supabase에서 교재를 불러오거나 CSV 파일을 선택하세요.")
        self.headed = tk.BooleanVar(value=True)
        self.max_pages = tk.StringVar(value="200")
        self._build()
        self.root.after(150, self._poll)

    def _build(self):
        self.root.configure(bg="#f4f6fa")
        style = ttk.Style()
        try:
            style.theme_use("vista")
        except tk.TclError:
            style.theme_use("clam")
        style.configure("TFrame", background="#f4f6fa")
        style.configure("TLabel", background="#f4f6fa", foreground="#263449", font=("Malgun Gothic", 10))
        style.configure("Title.TLabel", background="#f4f6fa", foreground="#152238", font=("Malgun Gothic", 21, "bold"))
        style.configure("Sub.TLabel", background="#f4f6fa", foreground="#64748b", font=("Malgun Gothic", 9))
        style.configure("Card.TLabelframe", background="#ffffff", bordercolor="#dce3ed", relief="solid")
        style.configure("Card.TLabelframe.Label", background="#ffffff", foreground="#1e293b", font=("Malgun Gothic", 11, "bold"))
        style.configure("TButton", font=("Malgun Gothic", 10), padding=(12, 8))
        style.configure("Accent.TButton", font=("Malgun Gothic", 11, "bold"), padding=(18, 11))
        style.configure("TNotebook", background="#f4f6fa", borderwidth=0)
        style.configure("TNotebook.Tab", padding=(20, 11), font=("Malgun Gothic", 10, "bold"))
        style.configure("Treeview", rowheight=32, font=("Malgun Gothic", 9))
        style.configure("Treeview.Heading", font=("Malgun Gothic", 9, "bold"))

        outer = ttk.Frame(self.root, padding=(24, 20))
        outer.pack(fill="both", expand=True)
        header = ttk.Frame(outer)
        header.pack(fill="x", pady=(0, 16))
        ttk.Label(header, text="답지모음 로컬 탐색기", style="Title.TLabel").pack(anchor="w")
        ttk.Label(header, text="교재를 선택하고 검색을 시작하면 됩니다. 검색된 링크는 검수 후 사이트에 등록됩니다.", style="Sub.TLabel").pack(anchor="w", pady=(5, 0))

        self.tabs = ttk.Notebook(outer)
        self.tabs.pack(fill="both", expand=True)
        start_tab = ttk.Frame(self.tabs, padding=18)
        search_tab = ttk.Frame(self.tabs, padding=18)
        advanced_tab = ttk.Frame(self.tabs, padding=18)
        self.tabs.add(start_tab, text="① 시작하기")
        self.tabs.add(search_tab, text="② 검색 및 결과")
        self.tabs.add(advanced_tab, text="③ 고급 설정")

        intro = ttk.LabelFrame(start_tab, text="처음 사용하는 경우", style="Card.TLabelframe", padding=16)
        intro.pack(fill="x", pady=(0, 14))
        ttk.Label(intro, text="아래 순서대로 진행하세요.", font=("Malgun Gothic", 12, "bold")).pack(anchor="w")
        ttk.Label(intro, text="1. 교재 CSV를 선택하거나 Supabase에서 교재를 가져옵니다.\n2. '검색 및 결과' 탭에서 검색을 시작합니다.\n3. 결과를 확인한 뒤 Supabase에 검수 대기 후보로 등록합니다.", justify="left").pack(anchor="w", pady=(8, 0))

        bookbox = ttk.LabelFrame(start_tab, text="1. 교재 목록 준비", style="Card.TLabelframe", padding=16)
        bookbox.pack(fill="x", pady=(0, 14))
        ttk.Label(bookbox, text="교재 CSV 파일", font=("Malgun Gothic", 10, "bold")).pack(anchor="w")
        csvrow = ttk.Frame(bookbox)
        csvrow.pack(fill="x", pady=(7, 5))
        ttk.Entry(csvrow, textvariable=self.books_path).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(csvrow, text="CSV 파일 선택", command=self.choose_csv).pack(side="left")
        ttk.Label(bookbox, text="CSV에는 교재명(title 또는 교재명) 열이 필요합니다. 사이트 등록까지 하려면 id 열도 있어야 합니다.", style="Sub.TLabel", wraplength=850).pack(anchor="w")
        self.book_status = tk.StringVar(value="교재 목록을 선택하지 않았습니다.")
        ttk.Label(bookbox, textvariable=self.book_status, font=("Malgun Gothic", 9, "bold")).pack(anchor="w", pady=(8, 0))

        connect_header = ttk.Frame(start_tab)
        connect_header.pack(fill="x", pady=(0, 6))
        ttk.Label(connect_header, text="Supabase 연결 (사이트에서 교재 가져오기 및 후보 등록)", font=("Malgun Gothic", 10, "bold")).pack(side="left")
        self.connection_toggle = ttk.Button(connect_header, text="연결 설정 펼치기", command=self.toggle_connection)
        self.connection_toggle.pack(side="right")
        self.connection_frame = ttk.LabelFrame(start_tab, text="관리자 연결 정보", style="Card.TLabelframe", padding=14)
        self._entry(self.connection_frame, "프로젝트 URL", self.supabase_url, 0)
        self._entry(self.connection_frame, "Anon / Publishable Key", self.anon_key, 1)
        self._entry(self.connection_frame, "관리자 이메일", self.email, 2)
        self._entry(self.connection_frame, "관리자 비밀번호", self.password, 3, show="•")
        conn_buttons = ttk.Frame(self.connection_frame)
        conn_buttons.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(10, 0))
        ttk.Button(conn_buttons, text="로그인하고 교재 가져오기", command=self.fetch_books, style="Accent.TButton").pack(side="left")
        ttk.Button(conn_buttons, text="검색 후보 사이트 등록", command=self.upload_candidates).pack(side="left", padx=8)
        ttk.Label(self.connection_frame, text="비밀번호는 파일에 저장하지 않습니다. 사이트 등록에는 관리자 권한이 필요합니다.", style="Sub.TLabel").grid(row=5, column=0, columnspan=3, sticky="w", pady=(8, 0))
        self.connection_frame.pack_forget()

        searchbox = ttk.LabelFrame(search_tab, text="2. 답지 링크 검색", style="Card.TLabelframe", padding=16)
        searchbox.pack(fill="x", pady=(0, 12))
        ttk.Label(searchbox, text="선택한 교재 목록을 대상으로 Google·Bing 공개 검색과 출판사 자료실을 탐색합니다.", style="Sub.TLabel").pack(anchor="w", pady=(0, 10))
        controls = ttk.Frame(searchbox)
        controls.pack(fill="x")
        ttk.Label(controls, text="출처별 최대 페이지").pack(side="left")
        ttk.Entry(controls, textvariable=self.max_pages, width=7).pack(side="left", padx=(8, 18))
        ttk.Checkbutton(controls, text="Google 인증이 필요할 때 브라우저 표시", variable=self.headed).pack(side="left")
        self.run_button = ttk.Button(controls, text="검색 시작", command=self.run_finder, style="Accent.TButton")
        self.run_button.pack(side="right")
        self.stop_button = ttk.Button(controls, text="검색 중지", command=self.stop_finder, state="disabled")
        self.stop_button.pack(side="right", padx=8)
        self.progress = ttk.Progressbar(search_tab, mode="indeterminate")
        self.progress.pack(fill="x", pady=(0, 8))
        self.search_status = tk.StringVar(value="대기 중 · 교재 목록을 준비한 뒤 검색을 시작하세요.")
        ttk.Label(search_tab, textvariable=self.search_status, font=("Malgun Gothic", 10, "bold")).pack(anchor="w", pady=(0, 8))

        preview = ttk.LabelFrame(search_tab, text="검색 후보", style="Card.TLabelframe", padding=12)
        preview.pack(fill="both", expand=True, pady=(0, 10))
        columns = ("book", "candidate", "status", "score", "url")
        self.results = ttk.Treeview(preview, columns=columns, show="headings", height=8)
        for column, label, width in (("book", "교재", 190), ("candidate", "후보 페이지", 220), ("status", "판정", 80), ("score", "점수", 60), ("url", "주소 · 더블클릭해 열기", 340)):
            self.results.heading(column, text=label)
            self.results.column(column, width=width, anchor="w" if column in ("book", "candidate", "url") else "center")
        result_scroll = ttk.Scrollbar(preview, orient="vertical", command=self.results.yview)
        self.results.configure(yscrollcommand=result_scroll.set)
        self.results.pack(side="left", fill="both", expand=True)
        result_scroll.pack(side="right", fill="y")
        self.results.bind("<Double-1>", self.open_selected_result)

        result_actions = ttk.Frame(search_tab)
        result_actions.pack(fill="x", pady=(0, 10))
        ttk.Button(result_actions, text="결과 CSV 열기", command=self.open_output).pack(side="left")
        ttk.Button(result_actions, text="Supabase 검수 대기 목록에 등록", command=self.upload_candidates, style="Accent.TButton").pack(side="right")

        logcard = ttk.LabelFrame(search_tab, text="상세 진행 로그", style="Card.TLabelframe", padding=10)
        logcard.pack(fill="both", expand=True)
        self.log = tk.Text(logcard, height=7, state="disabled", wrap="word", font=("Malgun Gothic", 9),
                           bg="#ffffff", fg="#334155", relief="solid", bd=1, padx=10, pady=8)
        self.log.pack(fill="both", expand=True)

        sourcecard = ttk.LabelFrame(advanced_tab, text="검색 출처 및 검색 세부 설정", style="Card.TLabelframe", padding=14)
        sourcecard.pack(fill="both", expand=True)
        ttk.Label(sourcecard, text="일반 사용자는 수정할 필요가 없습니다. 기본 설정으로 검색할 수 있습니다.", style="Sub.TLabel").pack(anchor="w")
        editor = ttk.Frame(sourcecard)
        editor.pack(fill="both", expand=True, pady=(10, 8))
        self.config_text = tk.Text(editor, height=18, wrap="none", font=("Consolas", 10), undo=True,
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
                initial_config = example.read_text(encoding="utf-8")
            else:
                initial_config = json.dumps({"sources": [], "max_sitemap_urls_per_source": 200, "request_delay_seconds": 1.5, "page_timeout_ms": 20000, "answer_keywords": ["정답과 해설", "정답 해설", "답지"], "web_search": {"enabled": True, "engines": ["bing", "google"], "results_per_engine": 8, "max_queries_per_book": 5}}, ensure_ascii=False, indent=2)
            self.config_text.insert("1.0", initial_config)
        cfgbuttons = ttk.Frame(sourcecard)
        cfgbuttons.pack(fill="x")
        ttk.Button(cfgbuttons, text="고급 설정 저장 및 검사", command=self.save_config, style="Accent.TButton").pack(side="left")
        ttk.Button(cfgbuttons, text="기본 설정으로 복원", command=self.restore_default_config).pack(side="left", padx=8)

        footer = ttk.Frame(outer)
        footer.pack(fill="x", pady=(12, 0))
        self.status_label = ttk.Label(footer, textvariable=self.status, style="Sub.TLabel", wraplength=950)
        self.status_label.pack(anchor="w")

        if BOOKS_CSV.is_file():
            self.books_path.set(str(BOOKS_CSV))
        self._update_book_status()
        self.load_results()

    def toggle_connection(self):
        if self.connection_frame.winfo_manager():
            self.connection_frame.pack_forget()
            self.connection_toggle.configure(text="연결 설정 펼치기")
        else:
            self.connection_frame.pack(fill="x", pady=(0, 10))
            self.connection_toggle.configure(text="연결 설정 접기")

    def restore_default_config(self):
        example = ROOT / "sources.example.json"
        if not example.is_file():
            messagebox.showerror("기본 설정 없음", "프로그램에 기본 출처 설정 파일이 없습니다.")
            return
        try:
            self.config_text.delete("1.0", "end")
            self.config_text.insert("1.0", example.read_text(encoding="utf-8"))
            if self.save_config():
                self.log_line("[설정] 기본 출처 설정을 복원했습니다.")
        except Exception as exc:
            messagebox.showerror("설정 복원 실패", str(exc))

    def _update_book_status(self):
        path = Path(self.books_path.get().strip()) if self.books_path.get().strip() else None
        if path and path.is_file():
            try:
                from finder import read_books
                books = read_books(path)
                self.book_status.set(f"준비 완료 · 교재 {len(books):,}권 · {path.name}")
                self.search_status.set(f"준비 완료 · 교재 {len(books):,}권을 검색할 수 있습니다.")
                return
            except Exception as exc:
                self.book_status.set(f"파일 확인 필요 · {exc}")
        else:
            self.book_status.set("교재 목록을 선택하지 않았습니다.")
        self.search_status.set("대기 중 · 먼저 교재 CSV를 선택하거나 Supabase에서 가져오세요.")

    def _entry(self, parent, label, variable, row, show=None):
        ttk.Label(parent, text=label, width=22).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=variable, show=show or "").grid(row=row, column=1, columnspan=2, sticky="ew", pady=3)
        parent.columnconfigure(1, weight=1)

    def log_line(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")
        try:
            stamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            with (DATA_DIR / "app.log").open("a", encoding="utf-8") as handle:
                handle.write(f"[{stamp}] {text}\n")
        except OSError:
            pass

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
                    self._update_book_status()
                    self.tabs.select(0)
                elif kind == "paused":
                    self.run_button.configure(state="normal")
                    self.stop_button.configure(state="disabled")
                    self.progress.stop()
                    self.status.set(value)
                    self.search_status.set("중지됨 · 현재까지 수집한 후보는 CSV에 저장했습니다.")
                    self.load_results()
                    messagebox.showwarning("검색 중지", value)
                elif kind == "done":
                    self.stop_button.configure(state="disabled")
                    self.run_button.configure(state="normal")
                    if hasattr(self, "progress"):
                        self.progress.stop()
                    self.status.set(value)
                    self.search_status.set("완료 · 검색 결과를 확인하고 필요한 후보를 등록하세요.")
                    self.load_results()
                    messagebox.showinfo("완료", value)
                elif kind == "error":
                    self.stop_button.configure(state="disabled")
                    self.run_button.configure(state="normal")
                    if hasattr(self, "progress"):
                        self.progress.stop()
                    self.status.set("오류 발생 · 상세 내용은 진행 로그에 표시했습니다.")
                    self.search_status.set("오류 발생 · 아래 상세 진행 로그의 마지막 항목을 확인하세요.")
                    self.log_line("[오류] " + value)
                    messagebox.showerror("오류", value)
        except queue.Empty:
            pass
        self.root.after(150, self._poll)

    def choose_csv(self):
        path = filedialog.askopenfilename(filetypes=[("CSV files", "*.csv"), ("All files", "*.*")])
        if path:
            self.books_path.set(path)
            self._update_book_status()
            self.status.set("교재 CSV를 선택했습니다. '검색 및 결과' 탭에서 검색을 시작할 수 있습니다.")

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
        if not all([base, key, email, password]):
            messagebox.showerror("연결 정보 필요", "프로젝트 URL, anon/publishable key, 관리자 이메일과 비밀번호를 모두 입력하세요.\nCSV로 검색만 할 경우 이 연결은 생략할 수 있습니다.")
            self.toggle_connection() if not self.connection_frame.winfo_manager() else None
            return
        parsed_base = urllib.parse.urlparse(base)
        if parsed_base.scheme != "https" or not parsed_base.netloc or parsed_base.username or parsed_base.password:
            messagebox.showerror("프로젝트 URL 확인", "Supabase 프로젝트 URL은 https://로 시작하는 주소여야 합니다.")
            return
        def worker():
            try:
                auth = request_json(base + "/auth/v1/token?grant_type=password",
                    {"apikey": key, "Content-Type": "application/json"}, {"email": email, "password": password})
                token = auth.get("access_token")
                self.access_token = token
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
                path = BOOKS_CSV
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
            self.tabs.select(0)
            messagebox.showerror("교재 목록 필요", "먼저 '시작하기' 탭에서 교재 CSV를 선택하거나 Supabase에서 교재를 가져오세요.")
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
        self.status.set("검색 중입니다. 창을 닫지 말고 진행 로그와 후보 수를 확인하세요.")
        self.tabs.select(1)
        self.search_status.set("검색 중 · 교재별 검색어를 만들고 공개 웹 자료를 확인하고 있습니다.")
        self.progress.start(12)
        self.log_line("[시작] 탐색 작업을 준비합니다.")
        def worker():
            try:
                from finder import run_search
                count = run_search(csv_path, OUTPUT, DEFAULT_CONFIG, headed, max_pages,
                                   lambda line: self.events.put(("log", line)), self.stop_event)
                if self.stop_event.is_set():
                    self.events.put(("paused", f"검색을 중지했습니다. 후보 {count}개를 CSV에 저장했습니다.\n저장 위치: {OUTPUT}"))
                else:
                    self.events.put(("done", f"탐색 완료: 후보 {count}개\n저장 위치: {OUTPUT}"))
            except Exception as exc:
                self.events.put(("error", str(exc)))
        threading.Thread(target=worker, daemon=True).start()


    def stop_finder(self):
        if self.stop_event is not None and not self.stop_event.is_set():
            self.stop_event.set()
            self.stop_button.configure(state="disabled")
            self.status.set("중지 요청을 보냈습니다. 현재 페이지 요청이 끝나면 후보를 저장하고 알림을 표시합니다.")
            self.log_line("[중지 요청] 현재 처리 중인 요청이 끝나는 대로 검색을 멈춥니다.")

    def upload_candidates(self):
        if not self.access_token or not self.project_url or not self.anon_key_value:
            messagebox.showerror("로그인 필요", "먼저 Supabase URL, anon key, 관리자 이메일과 비밀번호를 입력하고 '로그인 후 교재 CSV 저장'을 누르세요.")
            return
        if not OUTPUT.is_file():
            messagebox.showerror("결과 없음", "먼저 후보 탐색을 실행하세요.")
            return
        if not messagebox.askyesno("후보 등록", "검색 후보를 Supabase 관리자 검수 대기 목록에 등록합니다. 자동 승인되지는 않습니다. 계속할까요?"):
            return
        def worker():
            try:
                with OUTPUT.open("r", encoding="utf-8-sig", newline="") as handle:
                    rows = list(csv.DictReader(handle))
                if not rows:
                    raise RuntimeError("등록할 후보가 없습니다.")
                invalid = [index + 2 for index, row in enumerate(rows) if not row.get("book_id") or not row.get("url")]
                if invalid:
                    preview = ", ".join(map(str, invalid[:10]))
                    suffix = " 외" if len(invalid) > 10 else ""
                    raise RuntimeError(f"CSV {len(invalid)}개 행에 교재 ID 또는 URL이 없습니다. 누락 행: {preview}{suffix}. Supabase에서 교재 목록을 다시 가져오거나 CSV를 수정하세요.")
                inserted = duplicates = 0
                endpoint = self.project_url + "/functions/v1/answer-link-import-candidates"
                headers = {"apikey": self.anon_key_value, "Authorization": "Bearer " + self.access_token, "Content-Type": "application/json"}
                for start in range(0, len(rows), 100):
                    batch = []
                    for row in rows[start:start + 100]:
                        if not row.get("book_id") or not row.get("url"):
                            continue
                        batch.append({
                            "book_id": row.get("book_id"),
                            "title": row.get("candidate_title") or row.get("source_name") or "답지 후보",
                            "url": row.get("url"),
                            "snippet": row.get("snippet", ""),
                            "match_status": row.get("match_status", "uncertain"),
                            "link_type": row.get("link_type", "웹페이지"),
                            "source_type": "official" if row.get("source_type") == "publisher" else "general",
                            "query": row.get("search_query") or "local-search",
                        })
                    if not batch:
                        continue
                    result = request_json(endpoint, headers, {"candidates": batch})
                    inserted += int(result.get("inserted", 0))
                    duplicates += int(result.get("duplicates", 0))
                    self.events.put(("log", f"등록 처리 {min(start + 100, len(rows))}/{len(rows)}"))
                self.events.put(("done", f"사이트 등록 완료: 신규 후보 {inserted}개, 기존 중복 {duplicates}개. 관리자 페이지에서 검수하세요."))
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
        (SELF_TEST_LOG).write_text("SELF-TEST PASSED: config, matching, Tk, Playwright Chromium\\n", encoding="utf-8")
        return 0
    except Exception as exc:
        print(f"SELF-TEST FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        try:
            (SELF_TEST_LOG).write_text(f"SELF-TEST FAILED: {type(exc).__name__}: {exc}\\n", encoding="utf-8")
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        raise SystemExit(self_test())
    root = tk.Tk()
    FinderApp(root)
    root.mainloop()
