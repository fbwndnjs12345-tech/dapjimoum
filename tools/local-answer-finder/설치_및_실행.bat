@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/3] Python 확인 중...
py -3 --version >nul 2>&1
if errorlevel 1 (
  echo Python 3이 설치되어 있지 않습니다.
  echo https://www.python.org/downloads/windows/ 에서 Python 3.11 이상을 설치하고 Add Python to PATH를 체크하세요.
  pause
  exit /b 1
)
echo [2/3] 필요한 패키지 설치 중...
py -3 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
if errorlevel 1 goto failed
pip install -r requirements.txt
if errorlevel 1 goto failed
python -m playwright install chromium
if errorlevel 1 goto failed
echo [3/3] 프로그램 실행
python app.py
pause
exit /b 0
:failed
echo 설치 중 오류가 발생했습니다. 인터넷 연결과 Python 설치를 확인하세요.
pause
exit /b 1
