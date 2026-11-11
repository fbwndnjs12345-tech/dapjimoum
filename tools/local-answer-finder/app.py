from __future__ import annotations

import csv
import json
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
        self.access_token: str | None = None
        self.project_url: str = ''
        self.anon_key_value: str = ''
        self.books_path = tk.StringVar()
        self.supabase_url = tk.StringVar()
        self.anon_key = tk.StringVar()
        self.email = tk.StringVar()
        self.password = tk.StringVar()
        self.status = tk.StringVar(value="Supabase에서 교재를 불러오거나 CSV 파일을 선택하세요.")
        self.headed = tk.BooleanVar(value=False)
        self.max_pages = tk.StringVar(value="500")
        self._build()
        self.root.after(150, self._poll)

    def _build(self):
        outer = ttk.Frame(self.root, padding=16)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="답지모음 로컬 링크 탐색기", font=("Malgun Gothic", 18, "bold")).pack(anchor="w")
        ttk.Label(outer, text="검색 API 없이, 설정한 출판사 공식 사이트의 공개 자료를 확인해 답지 링크 후보를 만듭니다.", wraplength=850).pack(anchor="w", pady=(4, 14))

        supa = ttk.LabelFrame(outer, text="1. 사이트 교재 목록 가져오기 (선택)", padding=10)
        supa.pack(fill="x", pady=5)
        self._entry(supa, "Supabase URL", self.supabase_url, 0)
        self._entry(supa, "Anon / Publishable Key", self.anon_key, 1)
        self._entry(supa, "관리자 이메일", self.email, 2)
        self._entry(supa, "관리자 비밀번호", self.password, 3, show="•")
        row = ttk.Frame(supa); row.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(8, 0))
        ttk.Button(row, text="로그인 후 교재 CSV 저장", command=self.fetch_books).pack(side="left")
        ttk.Button(row, text="검색 후보를 사이트에 등록", command=self.upload_candidates).pack(side="left", padx=8)
        ttk.Label(row, text="비밀번호는 저장하지 않으며 Supabase 인증에만 사용합니다.", foreground="#555").pack(side="left", padx=10)

        csvbox = ttk.LabelFrame(outer, text="2. 교재 CSV", padding=10)
        csvbox.pack(fill="x", pady=5)
        ttk.Entry(csvbox, textvariable=self.books_path).pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Button(csvbox, text="CSV 선택", command=self.choose_csv).pack(side="left")

        cfg = ttk.LabelFrame(outer, text="3. 출판사 공식 사이트 설정", padding=10)
        cfg.pack(fill="both", expand=True, pady=5)
        ttk.Label(cfg, text="sources.json에 실제 공식 자료실 주소를 추가하세요. 처음에는 빈 목록이며 임의 사이트를 자동으로 긁지 않습니다.").pack(anchor="w")
        self.config_text = tk.Text(cfg, height=10, wrap="none", font=("Consolas", 9))
        self.config_text.pack(fill="both", expand=True, pady=6)
        if DEFAULT_CONFIG.exists():
            self.config_text.insert("1.0", DEFAULT_CONFIG.read_text(encoding="utf-8"))
        else:
            example = ROOT / "sources.example.json"
            if example.exists():
                self.config_text.insert("1.0", example.read_text(encoding="utf-8"))
            else:
                self.config_text.insert("1.0", json.dumps({"sources": [], "max_sitemap_urls_per_source": 500, "request_delay_seconds": 1.5, "page_timeout_ms": 20000, "answer_keywords": ["정답과 해설", "정답 해설", "답지"]}, ensure_ascii=False, indent=2))
        cfgbuttons = ttk.Frame(cfg); cfgbuttons.pack(fill="x")
        ttk.Button(cfgbuttons, text="설정 저장", command=self.save_config).pack(side="left")
        ttk.Button(cfgbuttons, text="예시 설정 열기", command=lambda: webbrowser.open(str(ROOT / "README.md"))).pack(side="left", padx=8)

        runbox = ttk.LabelFrame(outer, text="4. 후보 탐색", padding=10)
        runbox.pack(fill="x", pady=5)
        ttk.Label(runbox, text="출처별 최대 페이지").pack(side="left")
        ttk.Entry(runbox, textvariable=self.max_pages, width=8).pack(side="left", padx=8)
        ttk.Checkbutton(runbox, text="브라우저 창 표시", variable=self.headed).pack(side="left", padx=8)
        self.run_button = ttk.Button(runbox, text="탐색 시작", command=self.run_finder)
        self.run_button.pack(side="right")
        ttk.Button(runbox, text="결과 CSV 열기", command=self.open_output).pack(side="right", padx=8)

        ttk.Label(outer, textvariable=self.status, wraplength=850).pack(anchor="w", pady=(10, 3))
        self.log = tk.Text(outer, height=7, state="disabled", wrap="word", font=("Malgun Gothic", 9))
        self.log.pack(fill="both", expand=False)

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
                elif kind == "done":
                    self.run_button.configure(state="normal")
                    self.status.set(value)
                    messagebox.showinfo("완료", value)
                elif kind == "error":
                    self.run_button.configure(state="normal")
                    self.status.set("오류가 발생했습니다.")
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
            if not isinstance(config.get("sources"), list):
                raise ValueError("sources는 배열이어야 합니다.")
            DEFAULT_CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            self.events.put(("status", f"설정 저장 완료: {DEFAULT_CONFIG}"))
        except Exception as exc:
            messagebox.showerror("설정 오류", str(exc))

    def fetch_books(self):
        base = self.supabase_url.get().strip().rstrip("/")
        key = self.anon_key.get().strip()
        email = self.email.get().strip()
        password = self.password.get()
        def worker():
            try:
                if not all([base, key, email, password]):
                    raise ValueError("Supabase URL, anon key, 이메일, 비밀번호를 모두 입력하세요.")
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
                    query = urllib.parse.urlencode({"select": "id,title,publisher,subject,grade,semester,series", "order": "created_at.desc", "limit": str(limit), "offset": str(offset)})
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
            if not config.get("sources"):
                raise ValueError("출판사 공식 자료실 주소가 없습니다. sources.json에 최소 한 곳을 설정하세요.")
            self.save_config()
            max_pages = int(self.max_pages.get())
            if max_pages < 1:
                raise ValueError("최대 페이지는 1 이상이어야 합니다.")
        except Exception as exc:
            messagebox.showerror("설정 확인", str(exc))
            return
        headed = self.headed.get()
        self.run_button.configure(state="disabled")
        self.status.set("탐색 중입니다. 사이트별 robots.txt 정책을 확인하며 진행합니다.")
        def worker():
            try:
                from finder import run_search
                count = run_search(csv_path, OUTPUT, DEFAULT_CONFIG, headed, max_pages,
                                   lambda line: self.events.put(("log", line)))
                self.events.put(("done", f"탐색 완료: 후보 {count}개\n저장 위치: {OUTPUT}"))
            except Exception as exc:
                self.events.put(("error", str(exc)))
        threading.Thread(target=worker, daemon=True).start()


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

    def open_output(self):
        if OUTPUT.exists():
            webbrowser.open(str(OUTPUT))
        else:
            messagebox.showinfo("결과 없음", "아직 후보 CSV가 없습니다. 먼저 탐색을 실행하세요.")


if __name__ == "__main__":
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except tk.TclError:
        pass
    FinderApp(root)
    root.mainloop()
