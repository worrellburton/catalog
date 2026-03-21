@echo off
REM Maven Wrapper script for Windows
REM Simplified version - uses system Maven if available

where mvn >nul 2>&1
if %ERRORLEVEL% equ 0 (
    mvn %*
) else (
    echo Maven not found. Please install Maven or use the Unix wrapper.
    exit /b 1
)
