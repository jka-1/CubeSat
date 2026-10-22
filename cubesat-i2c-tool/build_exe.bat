@echo off
REM Build CubeSatI2CTool.exe on Windows (Python 3.10+ on PATH)
cd /d %~dp0
python -m venv .venv || goto :err
call .venv\Scripts\activate.bat
rem SSL DLL fix: strip msys64/mingw from PATH and put the base Python's DLLs dir first,
rem so PyInstaller bundles Python's own libssl/libcrypto (not C:\msys64\mingw64\bin).
for /f "usebackq delims=" %%P in (`python -c "import os,sys;d=os.path.join(sys.base_prefix,'DLLs');p=[x for x in os.environ['PATH'].split(';') if x and 'msys64' not in x.lower() and 'mingw' not in x.lower()];print(';'.join([d]+p))"`) do set "PATH=%%P"
echo Build PATH head: & python -c "import os;print(os.environ['PATH'].split(';')[:3])"
python -m pip install --upgrade pip
pip install -r requirements.txt -r requirements-dev.txt || goto :err
python -m pytest -q tests || goto :err
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
pyinstaller --noconfirm --clean --onefile --windowed --name CubeSatI2CTool run.py || goto :err
echo.
echo Built: dist\CubeSatI2CTool.exe
goto :eof
:err
echo Build failed.
exit /b 1
