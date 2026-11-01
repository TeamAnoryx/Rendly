# Starts every Rendly backend service in THIS terminal.
# Each service's output is streamed here with a colored [service] prefix, and
# a health check (GET /health) reports when each one is up.
# Logs are also written to backend\.run\logs\<service>.log.
# Press Ctrl+C to stop all services.

$ErrorActionPreference = 'Stop'
$backendDir = Split-Path -Parent $PSScriptRoot
Set-Location $backendDir

$logDir = Join-Path $backendDir '.run\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$services = @(
    @{ Name = 'auth-service';       Dir = 'services\auth-service';       PortVar = 'AUTH_SERVICE_PORT';       Port = 4001; Color = 'Cyan' }
    @{ Name = 'user-service';       Dir = 'services\user-service';       PortVar = 'USER_SERVICE_PORT';       Port = 3002; Color = 'Green' }
    @{ Name = 'matching-service';   Dir = 'services\matching-service';   PortVar = 'MATCHING_SERVICE_PORT';   Port = 3003; Color = 'Yellow' }
    @{ Name = 'chat-service';       Dir = 'services\chat-service';       PortVar = 'CHAT_SERVICE_PORT';       Port = 3004; Color = 'Magenta' }
    @{ Name = 'video-service';      Dir = 'services\video-service';      PortVar = 'VIDEO_SERVICE_PORT';      Port = 3005; Color = 'Blue' }
    @{ Name = 'moderation-service'; Dir = 'services\moderation-service'; PortVar = 'MODERATION_SERVICE_PORT'; Port = 3006; Color = 'DarkYellow' }
    @{ Name = 'huddle-service';     Dir = 'services\huddle-service';     PortVar = 'HUDDLE_SERVICE_PORT';     Port = 3007; Color = 'DarkCyan' }
    @{ Name = 'admin-service';      Dir = 'services\admin-service';      PortVar = 'ADMIN_SERVICE_PORT';      Port = 3008; Color = 'White' }
)

# Read backend\.env so port overrides there are honored.
$envFile = Join-Path $backendDir '.env'
$envFromFile = @{}
if (Test-Path $envFile) {
    try {
        foreach ($line in Get-Content -Path $envFile -ErrorAction Stop) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
                $envFromFile[$matches[1]] = $matches[2]
            }
        }
    } catch {
        Write-Host "Could not read $envFile - using default ports. ($($_.Exception.Message))" -ForegroundColor Yellow
    }
}

function Resolve-Port($svc) {
    $fromProcessEnv = [Environment]::GetEnvironmentVariable($svc.PortVar)
    if ($fromProcessEnv) { return [int]$fromProcessEnv }
    if ($envFromFile.ContainsKey($svc.PortVar) -and $envFromFile[$svc.PortVar]) { return [int]$envFromFile[$svc.PortVar] }
    return $svc.Port
}

function Test-PortInUse([int]$port) {
    try {
        return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)
    } catch {
        # No listener on the port: Get-NetTCPConnection reports that as ObjectNotFound.
        if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { return $false }
        # Any other failure means we could not check. Say so, then try to start anyway.
        Write-Host ("could not check whether port {0} is free: {1}" -f $port, $_.Exception.Message) -ForegroundColor Yellow
        return $false
    }
}

# Install root workspace dependencies if they are missing.
if (-not (Test-Path (Join-Path $backendDir 'node_modules'))) {
    Write-Host 'node_modules missing, running npm install in backend...' -ForegroundColor Yellow
    & npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

$procs = @{}
$ports = @{}
$status = @{}

function Start-RendlyService($svc, [int]$port) {
    $name = $svc.Name
    $logPath = Join-Path $logDir "$name.log"
    try {
        Set-Content -Path $logPath -Value "=== $name starting $(Get-Date -Format s) ===" -ErrorAction Stop
    } catch {
        # Console output still works without the file log; warn once and continue.
        Write-Host ("[{0,-18}] cannot write log file {1}: {2}" -f $name, $logPath, $_.Exception.Message) -ForegroundColor Yellow
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = '/c npx ts-node src/server.ts'
    $psi.WorkingDirectory = Join-Path $backendDir $svc.Dir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables[$svc.PortVar] = "$port"
    $psi.EnvironmentVariables['PORT'] = "$port"

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    $p.EnableRaisingEvents = $true

    $info = @{ Name = $name; Color = $svc.Color; LogPath = $logPath; LogWarned = $false }

    $outAction = {
        $line = $EventArgs.Data
        if ($null -eq $line) { return }
        $info = $Event.MessageData
        $text = "[{0,-18}] {1}" -f $info.Name, $line
        $color = $info.Color
        if ($line -match '\berror\b|\bfatal\b|\bexception\b') { $color = 'Red' }
        Write-Host $text -ForegroundColor $color
        try {
            Add-Content -Path $info.LogPath -Value $text -ErrorAction Stop
        } catch {
            # A locked/unwritable log must not break the event handler; keep streaming to console.
            if (-not $info.LogWarned) {
                Write-Host ("[{0,-18}] log file write failed: {1}" -f $info.Name, $_.Exception.Message) -ForegroundColor Yellow
                $info.LogWarned = $true
            }
        }
    }
    Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action $outAction -MessageData $info -SourceIdentifier "out-$name" | Out-Null
    Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action $outAction -MessageData $info -SourceIdentifier "err-$name" | Out-Null

    try {
        [void]$p.Start()
        $p.BeginOutputReadLine()
        $p.BeginErrorReadLine()
    } catch {
        # cmd.exe missing or process launch refused: report it and mark the service failed.
        Write-Host ("[{0,-18}] failed to launch process: {1}" -f $name, $_.Exception.Message) -ForegroundColor Red
        return $null
    }
    return $p
}

Write-Host ''
Write-Host '=== Rendly backend ===' -ForegroundColor Cyan

foreach ($svc in $services) {
    $port = Resolve-Port $svc
    $ports[$svc.Name] = $port
    if (Test-PortInUse $port) {
        $status[$svc.Name] = 'PORT IN USE'
        Write-Host ("[{0,-18}] port {1} is already in use - not started. Stop the old process first." -f $svc.Name, $port) -ForegroundColor Red
        continue
    }
    Write-Host ("[{0,-18}] starting on port {1}" -f $svc.Name, $port) -ForegroundColor $svc.Color
    $proc = Start-RendlyService $svc $port
    if ($null -eq $proc) {
        $status[$svc.Name] = 'LAUNCH FAILED'
        continue
    }
    $procs[$svc.Name] = $proc
    $status[$svc.Name] = 'STARTING'
}

$timeoutSeconds = 120
if ($env:START_TIMEOUT_SECONDS) { $timeoutSeconds = [int]$env:START_TIMEOUT_SECONDS }
$deadline = (Get-Date).AddSeconds($timeoutSeconds)

try {
    # Health phase: poll /health until every started service answers 200,
    # fails (process exited), or the timeout is reached. Events keep printing logs.
    while ($true) {
        $pending = @($services | Where-Object { $status[$_.Name] -eq 'STARTING' })
        if ($pending.Count -eq 0) { break }

        foreach ($svc in $pending) {
            $name = $svc.Name
            $p = $procs[$name]
            if ($p.HasExited) {
                $status[$name] = 'EXITED'
                Write-Host ("[{0,-18}] EXITED with code {1} before becoming healthy - see backend\.run\logs\{0}.log" -f $name, $p.ExitCode) -ForegroundColor Red
                continue
            }
            try {
                $resp = Invoke-WebRequest -Uri ("http://localhost:{0}/health" -f $ports[$name]) -UseBasicParsing -TimeoutSec 2
                if ($resp.StatusCode -eq 200) {
                    $status[$name] = 'RUNNING'
                    Write-Host ("[{0,-18}] RUNNING OK  http://localhost:{1}" -f $name, $ports[$name]) -ForegroundColor Green
                }
            } catch {
                # not up yet
            }
        }

        if ((Get-Date) -gt $deadline) {
            foreach ($svc in @($services | Where-Object { $status[$_.Name] -eq 'STARTING' })) {
                $status[$svc.Name] = 'TIMEOUT'
                Write-Host ("[{0,-18}] NOT HEALTHY after {1}s - see backend\.run\logs\{0}.log" -f $svc.Name, $timeoutSeconds) -ForegroundColor Red
            }
            break
        }
        Start-Sleep -Seconds 2
    }

    Write-Host ''
    Write-Host '=== Status ===' -ForegroundColor Cyan
    foreach ($svc in $services) {
        $color = 'Green'
        if ($status[$svc.Name] -ne 'RUNNING') { $color = 'Red' }
        Write-Host ("{0,-20} port {1,-5} {2}" -f $svc.Name, $ports[$svc.Name], $status[$svc.Name]) -ForegroundColor $color
    }
    Write-Host ''
    Write-Host 'Live logs below. Press Ctrl+C to stop all services.' -ForegroundColor Cyan

    # Keep streaming logs until every service process has exited (or Ctrl+C).
    while ($true) {
        $alive = @($procs.Values | Where-Object { -not $_.HasExited })
        if ($alive.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }
    Write-Host 'All services have exited.' -ForegroundColor Yellow
}
finally {
    Write-Host ''
    Write-Host 'Stopping services...' -ForegroundColor Yellow
    foreach ($name in @($procs.Keys)) {
        $p = $procs[$name]
        if ($p -and -not $p.HasExited) {
            # /T kills the cmd -> npx -> node process tree.
            try {
                $output = & taskkill.exe /T /F /PID $p.Id 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-Host ("taskkill for {0} (pid {1}) exited {2}: {3}" -f $name, $p.Id, $LASTEXITCODE, ($output -join ' ')) -ForegroundColor Red
                }
            } catch {
                Write-Host ("could not run taskkill for {0} (pid {1}): {2}" -f $name, $p.Id, $_.Exception.Message) -ForegroundColor Red
            }
        }
        Unregister-Event -SourceIdentifier "out-$name" -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier "err-$name" -ErrorAction SilentlyContinue
        Write-Host ("stopped {0}" -f $name) -ForegroundColor Yellow
    }
}
