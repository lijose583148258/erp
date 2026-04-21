$source = "f:\爱牢达"
$tempBase = "f:\temp_migration"
$tempDir = "$tempBase\爱牢达"
$zipFile = "f:\爱牢达_CleanMigration.zip"

if (Test-Path $tempBase) { Remove-Item -Recurse -Force $tempBase }
New-Item -ItemType Directory -Path $tempDir | Out-Null

$excludeFolders = "node_modules", "dist", "Chemerp_v1.0", ".git", "logs", ".cache", ".last_build_id", "backups", "测试", "文档归档", ".gemini"
$excludeFiles = "*.log", ".env.local"

# Copy everything except exclusions
robocopy $source $tempDir /E /XD $excludeFolders /XF $excludeFiles /NFL /NDL /NJH /NJS /NC /NS /NP /R:0 /W:0 | Out-Null

if (Test-Path $zipFile) { Remove-Item -Force $zipFile }
Compress-Archive -Path "$tempDir" -DestinationPath $zipFile -Force

Remove-Item -Recurse -Force $tempBase
Write-Output "Created: $zipFile"
