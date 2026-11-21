from __future__ import annotations

import csv
import json
import math
import os
import re
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

APP_VERSION = "2.0.0"
ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
if getattr(sys, "frozen", False):
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(ROOT / "ms-playwright")
APP_DATA_DIR = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "DapjiMoumFinder"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_CONFIG = APP_DATA_DIR / "sources.json"
OUTPUT = APP_DATA_DIR / "answer-link-candidates.csv"
# Preserve settings/results from older portable builds when moving to the writable app-data location.
for legacy_name, destination in (("sources.json", DEFAULT_CONFIG), ("answer-link-candidates.csv", OUTPUT), ("books.csv", APP_DATA_DIR / "books.csv")):
    legacy_path = ROOT / legacy_name
    if not destination.exists() and legacy_path.is_file():
        try:
            import shutil
            shutil.copy2(legacy_path, destination)
        except OSError:
            pass


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
        root.title("답지모음 | 답지 링크 자동 탐색기")
        root.geometry("1120x820")
        root.minsize(900, 680)
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
        self.kakao_api_key = tk.StringVar()
        self.password_visible = tk.BooleanVar(value=False)
        self.status = tk.StringVar(value="Supabase에서 교재를 불러오거나 CSV 파일을 선택하세요.")
        self.headed = tk.BooleanVar(value=True)
        self.max_pages = tk.StringVar(value="500")
        self.auto_upload = tk.BooleanVar(value=True)
        self._build()
        self.root.after(150, self._poll)

    def _build(self):
        """Build a compact, enterprise-style workspace with clear task separation."""
        self.root.configure(bg="#f3f5f9")
        self.root.title("답지모음 | 로컬 탐색기")
        self.root.geometry("1320x880")
        self.root.minsize(1080, 740)

        style = ttk.Style()
        try:
            style.theme_use("vista")
        except tk.TclError:
            style.theme_use("clam")

        bg = "#f3f5f9"
        surface = "#ffffff"
        ink = "#172033"
        muted = "#68758b"
        line = "#e2e7ef"
        accent = "#2457d6"
        style.configure(".", font=("Malgun Gothic", 9))
        style.configure("TFrame", background=bg)
        style.configure("Surface.TFrame", background=surface)
        style.configure("TLabel", background=bg, foreground=ink)
        style.configure("Muted.TLabel", background=bg, foreground=muted)
        style.configure("Hero.TLabel", background=bg, foreground=ink, font=("Malgun Gothic", 21, "bold"))
        style.configure("Section.TLabel", background=surface, foreground=ink, font=("Malgun Gothic", 11, "bold"))
        style.configure("Metric.TLabel", background=surface, foreground=ink, font=("Malgun Gothic", 18, "bold"))
        style.configure("MetricCaption.TLabel", background=surface, foreground=muted, font=("Malgun Gothic", 8))
        style.configure("TButton", padding=(12, 8), font=("Malgun Gothic", 9))
        style.configure("Accent.TButton", padding=(16, 9), font=("Malgun Gothic", 9, "bold"),
                        background=accent, foreground="#ffffff")
        style.map("Accent.TButton", background=[("active", "#1d49b5"), ("disabled", "#aab6cf")])
        style.configure("TNotebook", background=bg, borderwidth=0, tabmargins=(0, 0, 0, 0))
        style.configure("TNotebook.Tab", padding=(22, 12), font=("Malgun Gothic", 9, "bold"))
        style.map("TNotebook.Tab", background=[("selected", surface), ("!selected", "#e9edf4")],
                  foreground=[("selected", accent), ("!selected", muted)])
        style.configure("Treeview", rowheight=31, font=("Malgun Gothic", 9),
                        background=surface, fieldbackground=surface, foreground=ink)
        style.configure("Treeview.Heading", font=("Malgun Gothic", 9, "bold"),
                        background="#f0f3f8", foreground="#344054", padding=(8, 9))
        style.map("Treeview", background=[("selected", "#e6edff")],
                  foreground=[("selected", ink)])
        style.configure("Horizontal.TProgressbar", troughcolor="#e7ebf2", background=accent,
                        bordercolor="#e7ebf2", lightcolor=accent, darkcolor=accent)

        outer = ttk.Frame(self.root, padding=(24, 20))
        outer.pack(fill="both", expand=True)

        header = ttk.Frame(outer)
        header.pack(fill="x", pady=(0, 17))
        heading = ttk.Frame(header)
        heading.pack(side="left", fill="x", expand=True)
        ttk.Label(heading, text="답지모음", style="Hero.TLabel").pack(anchor="w")
        ttk.Label(heading, text=f"LOCAL DISCOVERY WORKSPACE  /  v{APP_VERSION}  /  교재별 공개 답지 링크 탐색",
                  style="Muted.TLabel").pack(anchor="w", pady=(3, 0))
        self.connection_badge = ttk.Label(header, text="● 로컬 모드", foreground="#26734d",
                                          background="#e8f5ed", padding=(12, 7))
        self.connection_badge.pack(side="right", anchor="n")

        metrics = ttk.Frame(outer)
        metrics.pack(fill="x", pady=(0, 15))
        for i in range(3):
            metrics.columnconfigure(i, weight=1, uniform="metric")
        self.metric_books = tk.StringVar(value="—")
        self.metric_candidates = tk.StringVar(value="—")
        self.metric_output = tk.StringVar(value="대기 중")
        for col, (caption, variable) in enumerate((
            ("불러온 교재", self.metric_books),
            ("수집 후보", self.metric_candidates),
            ("최근 작업", self.metric_output),
        )):
            card = ttk.Frame(metrics, style="Surface.TFrame", padding=(16, 12))
            card.grid(row=0, column=col, sticky="nsew", padx=(0 if col == 0 else 8, 0))
            ttk.Label(card, text=caption, style="MetricCaption.TLabel").pack(anchor="w")
            ttk.Label(card, textvariable=variable, style="Metric.TLabel").pack(anchor="w", pady=(4, 0))

        self.tabs = ttk.Notebook(outer)
        self.tabs.pack(fill="both", expand=True)

        account = ttk.Frame(self.tabs, padding=18)
        sources = ttk.Frame(self.tabs, padding=18)
        search = ttk.Frame(self.tabs, padding=18)
        self.tabs.add(account, text="  01  데이터 및 계정  ")
        self.tabs.add(sources, text="  02  검색 설정  ")
        self.tabs.add(search, text="  03  탐색 결과  ")

        account.columnconfigure(0, weight=3)
        account.columnconfigure(1, weight=2)
        account.rowconfigure(0, weight=1)

        supa = ttk.Frame(account, style="Surface.TFrame", padding=18)
        supa.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
        ttk.Label(supa, text="Supabase 연결", style="Section.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 5))
        ttk.Label(supa, text="관리자 계정으로 교재 목록을 가져오고, 탐색 결과를 검수 대기 후보로 전달합니다.",
                  style="MetricCaption.TLabel", wraplength=620).grid(
            row=1, column=0, columnspan=3, sticky="w", pady=(0, 16))
        self._entry(supa, "프로젝트 URL", self.supabase_url, 2)
        self._entry(supa, "Anon / Publishable Key", self.anon_key, 3)
        self._entry(supa, "관리자 이메일", self.email, 4)
        self._entry(supa, "관리자 비밀번호", self.password, 5, show="•")
        buttons = ttk.Frame(supa, style="Surface.TFrame")
        buttons.grid(row=6, column=0, columnspan=3, sticky="w", pady=(16, 0))
        ttk.Button(buttons, text="로그인 및 교재 가져오기", command=self.fetch_books,
                   style="Accent.TButton").pack(side="left")
        ttk.Button(buttons, text="후보 업로드", command=self.upload_candidates).pack(side="left", padx=(8, 0))
        ttk.Separator(supa).grid(row=7, column=0, columnspan=3, sticky="ew", pady=(16, 10))
        ttk.Label(supa, text="공식 검색 API", style="Section.TLabel").grid(row=8, column=0, sticky="w", pady=(0, 6))
        self._entry(supa, "Kakao REST API Key", self.kakao_api_key, 9, show="•")
        ttk.Label(supa, text="검색 키는 실행 중 메모리에서만 사용합니다. 설정 파일에는 저장하지 않습니다. "
                  "Google/Bing 검색 결과 페이지 직접 수집은 robots.txt 및 서비스 정책 때문에 비활성화했습니다.",
                  style="MetricCaption.TLabel", wraplength=620).grid(
            row=10, column=0, columnspan=3, sticky="w", pady=(12, 0))

        csvbox = ttk.Frame(account, style="Surface.TFrame", padding=18)
        csvbox.grid(row=0, column=1, sticky="nsew", padx=(10, 0))
        ttk.Label(csvbox, text="교재 데이터", style="Section.TLabel").pack(anchor="w")
        ttk.Label(csvbox, text="CSV 파일을 선택해 Supabase 연결 없이도 로컬 탐색을 실행할 수 있습니다.",
                  style="MetricCaption.TLabel", wraplength=360).pack(anchor="w", pady=(5, 16))
        ttk.Label(csvbox, text="선택된 파일", style="MetricCaption.TLabel").pack(anchor="w")
        path_entry = ttk.Entry(csvbox, textvariable=self.books_path)
        path_entry.pack(fill="x", pady=(5, 10))
        ttk.Button(csvbox, text="CSV 파일 선택", command=self.choose_csv).pack(anchor="w")
        ttk.Separator(csvbox).pack(fill="x", pady=18)
        ttk.Label(csvbox, text="필수 데이터", style="Section.TLabel").pack(anchor="w")
        ttk.Label(csvbox, text="교재명(title)\n후보를 사이트에 등록하려면 교재 ID(id)가 필요합니다.\n\n"
                  "선택 항목\n출판사 · 시리즈 · 과목 · 학년 · 학기 · 판본 · 교육과정 · ISBN",
                  style="MetricCaption.TLabel", justify="left").pack(anchor="w", pady=(8, 0))

        sourcecard = ttk.Frame(sources, style="Surface.TFrame", padding=18)
        sourcecard.pack(fill="both", expand=True)
        sourcehead = ttk.Frame(sourcecard, style="Surface.TFrame")
        sourcehead.pack(fill="x")
        ttk.Label(sourcehead, text="검색 및 출처 정책", style="Section.TLabel").pack(side="left")
        ttk.Label(sourcehead, text="JSON  ·  저장 전 형식과 필수값을 검사합니다.",
                  style="MetricCaption.TLabel").pack(side="right")
        ttk.Label(sourcecard, text="Google·Bing 공개 검색과 출판사 공식 자료실을 설정합니다. robots.txt 및 대상 사이트 접근 정책을 준수합니다.",
                  style="MetricCaption.TLabel", wraplength=1100).pack(anchor="w", pady=(6, 12))
        editor = ttk.Frame(sourcecard, style="Surface.TFrame")
        editor.pack(fill="both", expand=True)
        self.config_text = tk.Text(editor, height=18, wrap="none", font=("Cascadia Code", 10), undo=True,
                                   bg="#fbfcfe", fg="#253047", insertbackground=ink,
                                   relief="solid", bd=1, padx=14, pady=12,
                                   highlightthickness=1, highlightbackground=line)
        yscroll = ttk.Scrollbar(editor, orient="vertical", command=self.config_text.yview)
        xscroll = ttk.Scrollbar(sourcecard, orient="horizontal", command=self.config_text.xview)
        self.config_text.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        self.config_text.pack(side="left", fill="both", expand=True)
        yscroll.pack(side="right", fill="y")
        xscroll.pack(fill="x", pady=(0, 10))
        if DEFAULT_CONFIG.exists():
            self.config_text.insert("1.0", DEFAULT_CONFIG.read_text(encoding="utf-8"))
        else:
            example = ROOT / "sources.example.json"
            if example.exists():
                self.config_text.insert("1.0", example.read_text(encoding="utf-8"))
            else:
                self.config_text.insert("1.0", json.dumps({
                    "sources": [], "max_sitemap_urls_per_source": 500,
                    "request_delay_seconds": 1.5, "page_timeout_ms": 20000,
                    "answer_keywords": ["정답과 해설", "정답 해설", "답지"],
                    "web_search": {"enabled": True, "engines": ["kakao_web", "kakao_blog", "kakao_cafe"],
                                   "results_per_engine": 8, "max_queries_per_book": 3}
                }, ensure_ascii=False, indent=2))
        config_actions = ttk.Frame(sourcecard, style="Surface.TFrame")
        config_actions.pack(fill="x", pady=(12, 0))
        ttk.Button(config_actions, text="설정 저장 및 유효성 검사",
                   command=self.save_config, style="Accent.TButton").pack(side="left")
        ttk.Button(config_actions, text="사용 설명서 열기",
                   command=lambda: webbrowser.open(str(ROOT / "README.md"))).pack(side="left", padx=8)

        search.rowconfigure(1, weight=1)
        search.columnconfigure(0, weight=1)
        runbox = ttk.Frame(search, style="Surface.TFrame", padding=16)
        runbox.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        runbox.columnconfigure(0, weight=1)
        runhead = ttk.Frame(runbox, style="Surface.TFrame")
        runhead.grid(row=0, column=0, sticky="ew")
        ttk.Label(runhead, text="탐색 작업", style="Section.TLabel").pack(side="left")
        ttk.Label(runhead, text="실행 전 데이터와 검색 설정을 확인하세요.",
                  style="MetricCaption.TLabel").pack(side="right")
        controls = ttk.Frame(runbox, style="Surface.TFrame")
        controls.grid(row=1, column=0, sticky="ew", pady=(12, 0))
        ttk.Label(controls, text="출처별 페이지 한도").pack(side="left")
        ttk.Entry(controls, textvariable=self.max_pages, width=8).pack(side="left", padx=(8, 18))
        ttk.Checkbutton(controls, text="브라우저 창 표시 (출처 사이트 확인)",
                        variable=self.headed).pack(side="left")
        ttk.Button(controls, text="결과 CSV 열기", command=self.open_output).pack(side="right")
        self.stop_button = ttk.Button(controls, text="중지 및 저장",
                                      command=self.stop_finder, state="disabled")
        self.stop_button.pack(side="right", padx=8)
        self.run_button = ttk.Button(controls, text="탐색 시작",
                                     command=self.run_finder, style="Accent.TButton")
        self.run_button.pack(side="right")
        ttk.Checkbutton(runbox, text="완료 후 Supabase 검수 대기 후보로 업로드 (로그인 필요)",
                        variable=self.auto_upload).grid(row=2, column=0, sticky="w", pady=(10, 0))
        self.progress = ttk.Progressbar(runbox, mode="determinate", maximum=100, value=0)
        self.progress.grid(row=3, column=0, sticky="ew", pady=(12, 0))
        self.progress_caption = ttk.Label(runbox, text="대기 중", style="MetricCaption.TLabel")
        self.progress_caption.grid(row=4, column=0, sticky="w", pady=(5, 0))

        workspace = ttk.Panedwindow(search, orient="vertical")
        workspace.grid(row=1, column=0, sticky="nsew")
        results_card = ttk.Frame(workspace, style="Surface.TFrame", padding=12)
        activity_card = ttk.Frame(workspace, style="Surface.TFrame", padding=12)
        workspace.add(results_card, weight=3)
        workspace.add(activity_card, weight=1)

        result_head = ttk.Frame(results_card, style="Surface.TFrame")
        result_head.pack(fill="x", pady=(0, 10))
        ttk.Label(result_head, text="후보 목록", style="Section.TLabel").pack(side="left")
        self.result_count = tk.StringVar(value="0개")
        ttk.Label(result_head, textvariable=self.result_count,
                  style="MetricCaption.TLabel").pack(side="left", padx=(8, 0))
        self.filter_text = tk.StringVar()
        filter_entry = ttk.Entry(result_head, textvariable=self.filter_text, width=34)
        filter_entry.pack(side="right")
        ttk.Label(result_head, text="목록 필터", style="MetricCaption.TLabel").pack(side="right", padx=(0, 8))
        self.filter_text.trace_add("write", lambda *_: self.load_results())

        table_wrap = ttk.Frame(results_card, style="Surface.TFrame")
        table_wrap.pack(fill="both", expand=True)
        columns = ("book", "candidate", "status", "score", "url")
        self.results = ttk.Treeview(table_wrap, columns=columns, show="headings", height=10)
        for column, label, width in (
            ("book", "교재", 220), ("candidate", "후보 페이지", 260),
            ("status", "매칭 상태", 100), ("score", "점수", 70), ("url", "후보 주소", 420)
        ):
            self.results.heading(column, text=label)
            self.results.column(column, width=width, minwidth=90,
                                stretch=(column in ("book", "candidate", "url")),
                                anchor="w" if column in ("book", "candidate", "url") else "center")
        yresult = ttk.Scrollbar(table_wrap, orient="vertical", command=self.results.yview)
        xresult = ttk.Scrollbar(results_card, orient="horizontal", command=self.results.xview)
        self.results.configure(yscrollcommand=yresult.set, xscrollcommand=xresult.set)
        self.results.pack(side="left", fill="both", expand=True)
        yresult.pack(side="right", fill="y")
        xresult.pack(fill="x")
        self.results.tag_configure("likely", foreground="#176b43")
        self.results.tag_configure("uncertain", foreground="#9a6700")
        self.results.bind("<Double-1>", self.open_selected_result)

        activity_head = ttk.Frame(activity_card, style="Surface.TFrame")
        activity_head.pack(fill="x", pady=(0, 8))
        ttk.Label(activity_head, text="실행 로그", style="Section.TLabel").pack(side="left")
        ttk.Label(activity_head, text="최근 이벤트가 아래에 표시됩니다.",
                  style="MetricCaption.TLabel").pack(side="right")
        logwrap = ttk.Frame(activity_card, style="Surface.TFrame")
        logwrap.pack(fill="both", expand=True)
        self.log = tk.Text(logwrap, height=7, state="disabled", wrap="word",
                           font=("Cascadia Mono", 9), bg="#fbfcfe", fg="#3b465b",
                           relief="solid", bd=1, padx=12, pady=9,
                           highlightthickness=1, highlightbackground=line)
        logscroll = ttk.Scrollbar(logwrap, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=logscroll.set)
        self.log.pack(side="left", fill="both", expand=True)
        logscroll.pack(side="right", fill="y")

        footer = ttk.Frame(outer)
        footer.pack(fill="x", pady=(12, 0))
        self.status_label = ttk.Label(footer, textvariable=self.status,
                                      style="Muted.TLabel", wraplength=1200)
        self.status_label.pack(anchor="w")
        self.all_result_rows = []
        self._last_progress = 0
        self.load_results()

    def _entry(self, parent, label, variable, row, show=None):
        ttk.Label(parent, text=label, width=22).grid(row=row, column=0, sticky="w", pady=3)
        entry = ttk.Entry(parent, textvariable=variable, show=("•" if show and not self.password_visible.get() else ""))
        entry.grid(row=row, column=1, sticky="ew", pady=3)
        if show:
            ttk.Checkbutton(parent, text="비밀번호 표시", variable=self.password_visible,
                            command=lambda: entry.configure(show="" if self.password_visible.get() else "•")).grid(
                                row=row, column=2, sticky="w", padx=(8, 0))
        parent.columnconfigure(1, weight=1)

    def log_line(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        # Bound the text widget so long-running searches do not consume unbounded UI memory.
        line_count = int(self.log.index("end-1c").split(".")[0])
        if line_count > 5000:
            self.log.delete("1.0", f"{line_count - 5000}.0")
        self.log.see("end")
        self.log.configure(state="disabled")
        match = re.search(r"\[진행\]\s*(\d+)\s*/\s*(\d+)", text)
        if match and hasattr(self, "progress"):
            current, total = int(match.group(1)), max(1, int(match.group(2)))
            percent = min(99, round(current * 100 / total))
            self.progress.configure(value=percent)
            self.progress_caption.configure(text=f"교재 처리 중 · {current:,}/{total:,} ({percent}%)")

    def _poll(self):
        # Drain a bounded number of events per tick so a burst of logs cannot freeze the UI.
        for _ in range(250):
            try:
                kind, value = self.events.get_nowait()
            except queue.Empty:
                break
            if kind == "log":
                self.log_line(value)
            elif kind == "status":
                self.status.set(value)
            elif kind == "clear_password":
                self.password.set("")
            elif kind == "books_path":
                self.books_path.set(value)
            elif kind == "books_count":
                self.metric_books.set(f"{int(value):,}권")
            elif kind == "connected":
                self.connection_badge.configure(text="● Supabase 연결됨", foreground="#176b43", background="#e8f5ed")
            elif kind == "paused":
                self.run_button.configure(state="normal")
                self.stop_button.configure(state="disabled")
                self.progress.configure(value=100)
                self.progress_caption.configure(text="중지됨 · 현재까지의 결과를 저장했습니다.")
                self.metric_output.set("중지 저장")
                self.status.set(value)
                self.load_results()
                messagebox.showwarning("검색 중지", value)
            elif kind == "done":
                self.stop_button.configure(state="disabled")
                self.run_button.configure(state="normal")
                self.progress.configure(value=100)
                self.progress_caption.configure(text="완료 · 결과 CSV 저장됨")
                self.metric_output.set("완료")
                self.status.set(value)
                self.load_results()
                messagebox.showinfo("완료", value)
            elif kind == "error":
                self.stop_button.configure(state="disabled")
                self.run_button.configure(state="normal")
                self.progress.stop()
                self.progress_caption.configure(text="오류 · 로그를 확인하세요.")
                self.metric_output.set("오류")
                self.status.set("오류가 발생했습니다. 로그와 입력 설정을 확인하세요.")
                self.log_line("[오류] " + value)
                messagebox.showerror("오류", value)
        self.root.after(60 if not self.events.empty() else 150, self._poll)

    def choose_csv(self):
        path = filedialog.askopenfilename(filetypes=[("CSV files", "*.csv"), ("All files", "*.*")])
        if path:
            self.books_path.set(path)
            try:
                from finder import read_books
                count = len(read_books(Path(path)))
                self.metric_books.set(f"{count:,}권")
                self.status.set(f"교재 CSV 확인 완료 · {count:,}권")
            except Exception as exc:
                self.metric_books.set("확인 필요")
                self.status.set(f"CSV 확인 실패: {exc}")

    def save_config(self):
        try:
            config = json.loads(self.config_text.get("1.0", "end"))
            sources = config.get("sources", [])
            web_cfg = config.get("web_search", {})
            web_enabled = bool(web_cfg.get("enabled", True))
            if not isinstance(sources, list):
                raise ValueError("sources는 배열이어야 합니다.")
            if not sources and not web_enabled:
                raise ValueError("공식 자료실 또는 공식 검색 API 중 하나 이상 활성화하세요.")
            engines = web_cfg.get("engines", ["kakao_web", "kakao_blog", "kakao_cafe"])
            if not isinstance(engines, list):
                raise ValueError("web_search.engines는 배열이어야 합니다.")
            legacy = [engine for engine in engines if engine in ("google", "bing")]
            if legacy:
                engines = [engine for engine in engines if engine not in ("google", "bing")]
                if not engines:
                    engines = ["kakao_web", "kakao_blog", "kakao_cafe"]
                web_cfg["engines"] = engines
                self.config_text.delete("1.0", "end")
                self.config_text.insert("1.0", json.dumps(config, ensure_ascii=False, indent=2))
                messagebox.showwarning("검색 정책 변경", "Google/Bing HTML 검색은 robots.txt에서 /search가 차단되거나 API가 종료되어 비활성화했습니다. 공식 Kakao 검색 API로 전환했습니다.")
            allowed_engines = {"kakao_web", "kakao_blog", "kakao_cafe"}
            if web_enabled and (not engines or any(engine not in allowed_engines for engine in engines)):
                raise ValueError("web_search.engines에는 kakao_web, kakao_blog, kakao_cafe 중 하나 이상을 지정하세요.")
            results_per_engine = int(web_cfg.get("results_per_engine", 8))
            if results_per_engine < 1 or results_per_engine > 50:
                raise ValueError("검색 API별 결과 수는 1~50 사이여야 합니다.")
            max_queries = int(web_cfg.get("max_queries_per_book", 8))
            if max_queries < 1 or max_queries > 10:
                raise ValueError("교재별 검색어 수는 1~10 사이여야 합니다.")
            max_candidates = int(web_cfg.get("max_candidates_per_book", 5))
            early_stop = int(web_cfg.get("early_stop_likely_candidates_per_book", 3))
            if max_candidates < 1 or max_candidates > 50 or early_stop < 1 or early_stop > 10:
                raise ValueError("교재별 후보 한도는 1~50, 조기 종료 기준은 1~10 사이여야 합니다.")
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
            self.events.put(("status", f"설정 검사 및 저장 완료: 공식 출처 {len(sources)}곳 · 공식 검색 API {'활성화' if web_enabled else '비활성화'}"))
            return True
        except Exception as exc:
            messagebox.showerror("설정 오류", str(exc))
            return False

    def fetch_books(self):
        base = self.supabase_url.get().strip().rstrip("/")
        key = self.anon_key.get().strip()
        email = self.email.get().strip()
        password = self.password.get()
        if base:
            parsed_base = urllib.parse.urlparse(base)
            if (parsed_base.scheme != "https" or not parsed_base.hostname or parsed_base.username
                    or parsed_base.password or parsed_base.query or parsed_base.fragment
                    or parsed_base.path not in ("", "/")):
                messagebox.showerror("프로젝트 URL 확인", "Supabase 프로젝트 URL은 경로·인증정보가 없는 HTTPS 주소여야 합니다.")
                return
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
                    query = urllib.parse.urlencode({"select": "id,title,publisher,subject,grade,semester,series,edition,curriculum_revision,isbn13", "order": "title.asc", "limit": str(limit), "offset": str(offset)})
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
                path = APP_DATA_DIR / "books.csv"
                fields = ["id", "title", "publisher", "subject", "grade", "semester", "series", "edition", "curriculum_revision", "isbn13"]
                with path.open("w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.DictWriter(f, fieldnames=fields)
                    writer.writeheader()
                    writer.writerows(rows)
                self.events.put(("books_path", str(path)))
                self.events.put(("books_count", len(rows)))
                self.events.put(("connected", True))
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
                raise ValueError("공식 자료실 또는 공식 검색 API 중 하나 이상 활성화하세요.")
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
        self.progress.configure(value=0)
        self.progress_caption.configure(text="작업 준비 중")
        self.metric_output.set("실행 중")
        self.log_line("[시작] 탐색 작업을 준비합니다.")
        auto_upload = self.auto_upload.get()
        def worker():
            try:
                from finder import run_search
                count = run_search(csv_path, OUTPUT, DEFAULT_CONFIG, headed, max_pages,
                                   lambda line: self.events.put(("log", line)), self.stop_event,
                                   {"kakao_rest_api_key": self.kakao_api_key.get().strip()})
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
        threading.Thread(target=worker, daemon=True).start()


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
        from finder import canonicalize_url, is_safe_public_url
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
                candidate_url = (row.get("url") or "").strip()
                if not is_safe_public_url(candidate_url, resolve_dns=True):
                    raise RuntimeError(f"공개 HTTP(S) URL이 아니거나 안전한 공개 호스트가 아닙니다: {candidate_url[:180]}")
                candidate_url = canonicalize_url(candidate_url)
                try:
                    raw_score = float(row.get("match_score") or 0)
                except (TypeError, ValueError):
                    raw_score = 0
                score = int(max(0, min(100, raw_score))) if math.isfinite(raw_score) else 0
                batch.append({
                    "book_id": row["book_id"],
                    "title": row.get("candidate_title") or row.get("source_name") or "답지 후보",
                    "url": candidate_url,
                    "snippet": row.get("snippet", ""),
                    "match_status": row.get("match_status", "uncertain"),
                    "match_score": score,
                    "match_evidence": {
                        "matched_answer_terms": row.get("matched_answer_terms", ""),
                        "book_title": row.get("book_title", ""),
                        "series": row.get("series", ""),
                        "subject": row.get("subject", ""),
                        "grade": row.get("grade", ""),
                        "semester": row.get("semester", ""),
                        "edition": row.get("edition", ""),
                        "curriculum_revision": row.get("curriculum_revision", ""),
                        "isbn13": row.get("isbn13", ""),
                    },
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
        if not hasattr(self, "results"):
            return
        for item in self.results.get_children():
            self.results.delete(item)
        if not OUTPUT.is_file():
            self.result_count.set("0개")
            self.metric_candidates.set("0개")
            return
        try:
            needle = self.filter_text.get().strip().casefold() if hasattr(self, "filter_text") else ""
            total = 0
            matched = 0
            shown = 0
            with OUTPUT.open("r", encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    total += 1
                    searchable = " ".join(str(row.get(key, "")) for key in (
                        "book_title", "candidate_title", "url", "source_name"
                    )).casefold()
                    if needle and needle not in searchable:
                        continue
                    matched += 1
                    if shown >= 1000:
                        continue
                    status = row.get("match_status", "")
                    tag = status if status in ("likely", "uncertain") else ""
                    self.results.insert("", "end", values=(
                        row.get("book_title", ""),
                        row.get("candidate_title", ""),
                        status,
                        row.get("match_score", ""),
                        row.get("url", ""),
                    ), tags=(tag,) if tag else ())
                    shown += 1
            self.result_count.set(f"{matched:,}개 일치 · {shown:,}개 표시")
            self.metric_candidates.set(f"{total:,}개")
            if matched > 1000:
                self.progress_caption.configure(text="화면 표시 1,000개 제한 · 전체 결과는 CSV에 보존됩니다.")
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
        (APP_DATA_DIR / "self-test.log").write_text("SELF-TEST PASSED: config, matching, Tk, Playwright Chromium\\n", encoding="utf-8")
        return 0
    except Exception as exc:
        print(f"SELF-TEST FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        try:
            (APP_DATA_DIR / "self-test.log").write_text(f"SELF-TEST FAILED: {type(exc).__name__}: {exc}\\n", encoding="utf-8")
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        raise SystemExit(self_test())
    root = tk.Tk()
    FinderApp(root)
    root.mainloop()
