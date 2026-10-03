param([string]$Node = 'node')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = Split-Path -Parent $projectRoot
& $Node (Join-Path $PSScriptRoot 'build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'dist/manifest.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $package.version) { throw 'Package and manifest versions differ.' }
$version = $manifest.version
$stageBase = [IO.Path]::GetFullPath((Join-Path $projectRoot 'test-results'))
$stage = Join-Path $stageBase ('release-' + [guid]::NewGuid().ToString())
$runtimeStage = Join-Path $stage 'runtime/bilibili-ambilight'
$sourceStage = Join-Path $stage 'source/bilibili-ambilight'
$null = New-Item -ItemType Directory -Path $runtimeStage,$sourceStage -Force
try {
    $runtimeFiles = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -File -Recurse
    foreach ($file in $runtimeFiles) {
        $relative = [IO.Path]::GetRelativePath((Join-Path $projectRoot 'dist'),$file.FullName)
        foreach ($base in @('src','')) {
            $original = Join-Path (Join-Path $projectRoot $base) $relative
            if ((Get-FileHash -LiteralPath $original).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw "Runtime mismatch: $relative" }
        }
        foreach ($target in @($runtimeStage,$sourceStage)) {
            $destination = Join-Path $target $relative
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force
            Copy-Item -LiteralPath $file.FullName -Destination $destination
        }
    }
    foreach ($name in @('README.md','LICENSE','THIRD-PARTY-NOTICES.md','验证报告.md')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $runtimeStage
        Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $sourceStage
    }
    foreach ($name in @('src','dist','tools','tests','package.json','.gitignore','.gitattributes')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $sourceStage -Recurse }
    $runtimeZip = Join-Path $outputRoot "bilibili-ambilight-v$version.zip"
    $sourceZip = Join-Path $outputRoot "bilibili-ambilight-source-v$version.zip"
    Compress-Archive -LiteralPath $runtimeStage -DestinationPath $runtimeZip -Force
    Compress-Archive -LiteralPath $sourceStage -DestinationPath $sourceZip -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach ($path in @($runtimeZip,$sourceZip)) {
        $archive = [IO.Compression.ZipFile]::OpenRead($path)
        try {
            $entry = $archive.GetEntry('bilibili-ambilight/manifest.json')
            if (!$entry) { throw 'Archive manifest is missing.' }
            $reader = [IO.StreamReader]::new($entry.Open())
            try { $packedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
            if ($packedManifest.version -ne $version) { throw 'Archive version differs.' }
            foreach ($content in $packedManifest.content_scripts) {
                foreach ($name in @($content.js) + @($content.css)) { if (!$archive.GetEntry("bilibili-ambilight/$name")) { throw "Archive dependency is missing: $name" } }
            }
            if ($archive.Entries.FullName | Where-Object { $_ -match '(^|/)(node_modules|profile|test-results)(/|$)' }) { throw 'Archive contains development state.' }
            [pscustomobject]@{ Path=$path; Files=$archive.Entries.Count; SHA256=(Get-FileHash -LiteralPath $path).Hash }
        } finally { $archive.Dispose() }
    }
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (!$resolvedStage.StartsWith($stageBase + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedStage) -notmatch '^release-[0-9a-f-]{36}$') { throw 'Staging cleanup path is invalid.' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
