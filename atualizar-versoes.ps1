$ErrorActionPreference = 'Stop'

# Execute antes de publicar. O hash muda somente quando o conteudo muda.
$assets = @('app.js', 'styles.css', 'logo.svg', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png')
$versions = @{}
foreach ($asset in $assets) {
    $assetPath = Join-Path $PSScriptRoot $asset
    $versions[$asset] = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
}

$htmlPath = Join-Path $PSScriptRoot 'index.html'
$html = [IO.File]::ReadAllText($htmlPath)
$alternatives = ($assets | ForEach-Object { [regex]::Escape($_) }) -join '|'
$pattern = '(?<prefix>\b(?:href|src)=")(?<file>' + $alternatives + ')(?:\?v=[a-fA-F0-9]+)?"'
$assetMatches = [regex]::Matches($html, $pattern)
foreach ($asset in $assets) {
    if (-not ($assetMatches | Where-Object { $_.Groups['file'].Value -eq $asset })) {
        throw "Referencia nao encontrada em index.html: $asset"
    }
}

$updated = [regex]::Replace($html, $pattern, {
    param($match)
    $asset = $match.Groups['file'].Value
    $match.Groups['prefix'].Value + $asset + '?v=' + $versions[$asset] + '"'
})

if ($updated -cne $html) {
    [IO.File]::WriteAllText($htmlPath, $updated, (New-Object Text.UTF8Encoding($false)))
    Write-Output 'Versoes atualizadas em index.html.'
} else {
    Write-Output 'Nenhum arquivo mudou. Versoes preservadas.'
}
