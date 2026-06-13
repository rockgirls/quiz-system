@echo off
echo ============================================
echo   在线答题系统 - 启动脚本
echo ============================================
echo.
echo [1] 启动答题系统（HTTP服务）
echo [2] OCR提取题库（需安装Tesseract）
echo [3] 退出
echo.
choice /c 123 /n /m "请选择 [1/2/3]: "

if errorlevel 3 goto :exit
if errorlevel 2 goto :ocr
if errorlevel 1 goto :serve

:serve
echo.
echo 启动答题系统...
echo 浏览器打开: http://localhost:8080
echo 按 Ctrl+C 停止服务
echo.
python -m http.server 8080 -d quiz-system
pause
goto :exit

:ocr
echo.
echo 启动OCR题库提取...
echo 请确保已安装 Tesseract OCR
echo.
python extract_questions.py
pause
goto :exit

:exit
