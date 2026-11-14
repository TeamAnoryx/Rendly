# Test Rendly service health endpoints (Windows)

$services = @(
    @{ Port = 4001; Name = "Auth" },
    @{ Port = 3002; Name = "User" },
    @{ Port = 3003; Name = "Matching" },
    @{ Port = 3004; Name = "CCS (Chat)" },
    @{ Port = 3005; Name = "Video" },
    @{ Port = 3006; Name = "Moderation" },
    @{ Port = 3007; Name = "Huddle" },
    @{ Port = 3008; Name = "Admin" }
)

Write-Host "Testing Rendly Services..." -ForegroundColor Cyan

foreach ($s in $services) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$($s.Port)/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        if ($r.StatusCode -eq 200) {
            Write-Host "OK $($s.Name) ($($s.Port))" -ForegroundColor Green
        } else {
            Write-Host "FAILED $($s.Name) ($($s.Port))" -ForegroundColor Red
        }
    } catch {
        Write-Host "FAILED $($s.Name) ($($s.Port))" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Frontend: http://localhost:3001" -ForegroundColor Yellow
Write-Host "API Gateway: http://localhost:80" -ForegroundColor Yellow
