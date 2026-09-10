@echo off
rem LoRA Manager standalone. Vendored next door in flux2klein (GPLv3),
rem not copied into this MIT repo. "Send to workflow" POSTs /api/lora-push
rem on whichever pai-zi-xia port is open (8787-8790).
setlocal EnableExtensions
cd /d "%~dp0"

set "LM="
if exist "%~dp0..\flux2klein\lora-manager\standalone.py" set "LM=%~dp0..\flux2klein\lora-manager"
if not defined LM if exist "C:\projects\flux2klein\lora-manager\standalone.py" set "LM=C:\projects\flux2klein\lora-manager"
if not defined LM (
  echo LoRA Manager not found.
  echo Expected C:\projects\flux2klein\lora-manager
  echo That folder is GPLv3 and lives in the flux2klein repo, not here.
  pause
  exit /b 1
)

echo pai-zi-xia  LoRA Manager
echo using     %LM%
echo open      http://127.0.0.1:7861/loras
cd /d "%LM%"
call start_lora_manager.bat %*
