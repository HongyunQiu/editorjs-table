@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo 开始构建 editorjs-table...
echo.

if not exist "node_modules\vite" (
    echo 未检测到 node_modules 或 vite 依赖，先执行 npm install --legacy-peer-deps ...
    call npm install --legacy-peer-deps
    set INSTALL_RESULT=!ERRORLEVEL!
    if !INSTALL_RESULT! NEQ 0 (
        echo npm install 失败！错误代码: !INSTALL_RESULT!
        echo.
        if /I "%~1" NEQ "--no-pause" (
            pause
        )
        exit /b !INSTALL_RESULT!
    )
    echo npm install 完成
    echo.
)

call npm run build
set BUILD_RESULT=!ERRORLEVEL!

echo.
echo 构建完成，返回码: !BUILD_RESULT!

if !BUILD_RESULT! NEQ 0 (
    echo 构建失败！错误代码: !BUILD_RESULT!
    echo.
    if /I "%~1" NEQ "--no-pause" (
        pause
    )
    exit /b !BUILD_RESULT!
)

echo 构建成功，开始复制 *.js 文件...
echo.

set SRC_DIR=dist
set DEST_DIR=..\..\QNotes\public\vendor\editorjs-table

if not exist "!SRC_DIR!" (
    echo 错误：找不到 !SRC_DIR! 目录！
    echo 请先确认 npm run build 能在 dist 下生成产物
    echo.
    if /I "%~1" NEQ "--no-pause" (
        pause
    )
    exit /b 1
)

if not exist "!DEST_DIR!" (
    echo 创建目标目录: !DEST_DIR!
    mkdir "!DEST_DIR!"
    set MKDIR_RESULT=!ERRORLEVEL!
    if !MKDIR_RESULT! NEQ 0 (
        echo 创建目录失败！错误代码: !MKDIR_RESULT!
        echo.
        if /I "%~1" NEQ "--no-pause" (
            pause
        )
        exit /b !MKDIR_RESULT!
    )
    echo 目标目录创建成功
)

set COPY_COUNT=0
for %%F in ("!SRC_DIR!\*.js") do (
    if exist "%%F" (
        echo 正在复制: %%~nxF
        copy /Y "%%F" "!DEST_DIR!\%%~nxF" >nul
        if !ERRORLEVEL! EQU 0 (
            set /a COPY_COUNT+=1
            echo   - 已复制到 !DEST_DIR!\%%~nxF
        ) else (
            echo   - 复制失败！
        )
    )
)

if !COPY_COUNT! EQU 0 (
    echo.
    echo 错误：未找到任何 *.js 文件可复制！
    echo 请确认 npm run build 在 dist 下生成了 .js 文件
    echo.
    if /I "%~1" NEQ "--no-pause" (
        pause
    )
    exit /b 1
)

echo.
echo ========================================
echo 完成！已复制 !COPY_COUNT! 个 .js 文件到:
echo !DEST_DIR!
echo ========================================

if /I "%~1" NEQ "--no-pause" (
    pause
)

exit /b 0
