# Instala MailForge Relay en Windows como tarea programada que arranca con el equipo.
# Ejecutar en PowerShell como Administrador, dentro de la carpeta relay\:  .\install-windows.ps1
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js no está instalado. Instálalo con: winget install OpenJS.NodeJS.LTS  (y reabre PowerShell)' }

Push-Location $dir
npm install --omit=dev
Pop-Location

# Crea relay.config.json (token) si no existe, ejecutando el servidor un instante
if (-not (Test-Path "$dir\relay.config.json")) {
  $p = Start-Process $node -ArgumentList "server.mjs" -WorkingDirectory $dir -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 3; Stop-Process $p -Force
}

$action  = New-ScheduledTaskAction -Execute $node -Argument "server.mjs" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$set     = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'MailForgeRelay' -Action $action -Trigger $trigger -Settings $set -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'MailForgeRelay'

# Que el equipo no se suspenda con corriente
powercfg /change standby-timeout-ac 0

$token = (Get-Content "$dir\relay.config.json" | ConvertFrom-Json).token
Write-Host "`nRelay instalado y en marcha (puerto 8787, solo localhost)." -ForegroundColor Green
Write-Host "Token para la app: $token"
Write-Host "Siguiente paso: instalar Tailscale y ejecutar:  tailscale serve --bg 8787"
