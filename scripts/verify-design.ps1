# Static design-system check over frontend/src.
# This file must stay UTF-8 WITH BOM: it contains Cyrillic, and Windows
# PowerShell 5.1 otherwise reads it as the legacy ANSI code page.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-design.ps1
param([string]$Root = '')

$ErrorActionPreference = 'Continue'

if (-not $Root) {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $Root = Join-Path (Split-Path -Parent $here) 'frontend\src'
}
$Root = (Resolve-Path $Root).Path
Write-Host "Каталог проверки: $Root" -ForegroundColor Gray

$script:pass = 0
$script:fail = 0
function Check { param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:pass++; Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("  FAIL  {0}  {1}" -f $Name, $Detail) -ForegroundColor Red }
}

$files = @(Get-ChildItem -Path $Root -Recurse -Include *.ts,*.tsx,*.css -File)
$rel = { param($p) $p.Replace($Root, '').TrimStart('\') }

# Every source line as "path:line:text", used by the text checks below.
$lines = @()
foreach ($f in $files) {
  $n = 0
  foreach ($line in [System.IO.File]::ReadAllLines($f.FullName)) {
    $n++
    $lines += [pscustomobject]@{ Path = (& $rel $f.FullName); Line = $n; Text = $line }
  }
}
Write-Host ("Файлов: {0}, строк: {1}`n" -f $files.Count, $lines.Count) -ForegroundColor Gray

# Only .ts/.tsx carry user-facing strings; .css carries the token declarations.
$src = @($lines | Where-Object { $_.Path -notlike '*.css' })
$cssLines = @($lines | Where-Object { $_.Path -eq 'index.css' })
$css = [System.IO.File]::ReadAllText((Join-Path $Root 'index.css'))

# ---------------------------------------------------------------------- 1
Write-Host "=== 1. Типографика: никаких длинных тире в пользовательских строках ===" -ForegroundColor Cyan
$emDash = [char]0x2014
$enDash = [char]0x2013
# Comments explain code and never reach a user, so they are excluded.
$code = @($src | Where-Object {
  $t = $_.Text.Trim()
  -not ($t.StartsWith('//') -or $t.StartsWith('*') -or $t.StartsWith('/*'))
})
$emHits = @($code | Where-Object { $_.Text.Contains($emDash) })
Check 'нет символа U+2014 (длинное тире)' ($emHits.Count -eq 0) (($emHits | ForEach-Object { "$($_.Path):$($_.Line)" }) -join ', ')
$enHits = @($code | Where-Object { $_.Text.Contains($enDash) })
Check 'нет символа U+2013 (короткое тире)' ($enHits.Count -eq 0) (($enHits | ForEach-Object { "$($_.Path):$($_.Line)" }) -join ', ')

$guillemetOpen = [char]0x00AB
$guillemetClose = [char]0x00BB
$quoteHits = @($code | Where-Object { $_.Text.Contains($guillemetOpen) -or $_.Text.Contains($guillemetClose) })
Check 'нет кавычек-ёлочек в интерфейсе' ($quoteHits.Count -eq 0) (($quoteHits | ForEach-Object { "$($_.Path):$($_.Line)" }) -join ', ')

# ---------------------------------------------------------------------- 2
Write-Host "`n=== 2. Никаких эмодзи в исходниках ===" -ForegroundColor Cyan
$emoji = @($src | Where-Object { $_.Text -match '[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2190-\u21FF]|[\u2600-\u27BF]|[\u2B00-\u2BFF]' })
Check 'нет эмодзи и символьных стрелок' ($emoji.Count -eq 0) (($emoji | ForEach-Object { "$($_.Path):$($_.Line)" }) -join ', ')

# ---------------------------------------------------------------------- 3
Write-Host "`n=== 3. Радиусы берутся из контракта темы ===" -ForegroundColor Cyan
$rawRadius = @($code | Where-Object { $_.Path -notlike 'theme\*' -and $_.Text -match 'borderRadius:\s*\d' })
# 999 marks a pill (avatars, status tags). Any other number must be a token.
$strayRadius = @($rawRadius | Where-Object { $_.Text -notmatch 'borderRadius:\s*999' })
Check 'числовой радиус в компонентах только 999' ($strayRadius.Count -eq 0) (($strayRadius | ForEach-Object { "$($_.Path):$($_.Line) $($_.Text.Trim())" }) -join ' | ')

Check 'объявлен один основной радиус --radius' ((@($cssLines | Where-Object { $_.Text -match '^\s*--radius:' })).Count -eq 1)
Check 'объявлен один малый радиус --radius-sm' ((@($cssLines | Where-Object { $_.Text -match '^\s*--radius-sm:' })).Count -eq 1)

# ---------------------------------------------------------------------- 4
Write-Host "`n=== 4. Цвета только через переменные темы ===" -ForegroundColor Cyan
$colourLines = @($code | Where-Object {
  $_.Path -notlike 'theme\*' -and $_.Text -match "'#[0-9a-fA-F]{3,8}'|rgba\(\s*\d"
})
Check 'нет hex-литералов в компонентах' ($colourLines.Count -eq 0) (($colourLines | ForEach-Object { "$($_.Path):$($_.Line) $($_.Text.Trim())" }) -join ' | ')

$themeVars = @($cssLines | Where-Object { $_.Text -match '^\s*--[a-z0-9-]+:' })
Check 'в index.css объявлены токены темы' ($themeVars.Count -ge 40) "найдено $($themeVars.Count)"

# ---------------------------------------------------------------------- 5
Write-Host "`n=== 5. Каждый раздел данных имеет состояния ===" -ForegroundColor Cyan
$tabs = @($files | Where-Object { $_.FullName -match '\\tabs\\' -and $_.Name -match '\.tsx$' })
Check 'найдены компоненты разделов' ($tabs.Count -ge 5) "найдено $($tabs.Count)"
foreach ($tab in $tabs) {
  $text = [System.IO.File]::ReadAllText($tab.FullName)
  $hasState = ($text -match 'EmptyState') -and (($text -match 'LoadingBlock') -or ($text -match 'Skeleton'))
  Check ("{0}: пустое и загрузочное состояние" -f $tab.Name) $hasState
}

$statesText = [System.IO.File]::ReadAllText((Join-Path $Root 'components\ui\States.tsx'))
foreach ($name in @('LoadingBlock', 'EmptyState', 'ErrorBlock')) {
  Check ("общий компонент {0} объявлен" -f $name) ($statesText -match ("export const {0}" -f $name))
}

# ---------------------------------------------------------------------- 6
Write-Host "`n=== 6. Один акцент и один набор радиусов ===" -ForegroundColor Cyan
$accentDecls = @($cssLines | Where-Object { $_.Text -match '^\s*--accent:' })
Check 'акцент объявлен ровно для двух тем' ($accentDecls.Count -eq 2) "найдено $($accentDecls.Count)"

# ---------------------------------------------------------------------- 7
Write-Host "`n=== 7. Доступность и движение ===" -ForegroundColor Cyan
Check 'есть видимое кольцо фокуса' ($css -match ':focus-visible')
Check 'reduced motion учтён' ($css -match 'prefers-reduced-motion')
Check 'настроен color-scheme' ($css -match 'color-scheme')

# A button whose only child is an icon needs an accessible name of its own.
$iconOnlyMissing = @()
foreach ($f in $files | Where-Object { $_.Name -match '\.tsx$' }) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  $pattern = '(?s)<Button\b(?:(?!</Button>).)*?icon=\{[^}]*\}(?:(?!</Button>).)*?</Button\s*>'
  foreach ($m in [regex]::Matches($text, $pattern)) {
    $block = $m.Value
    $plain = $block -replace '(?s)<[^>]+>', ' '
    $plain = ($plain -replace '\{[^{}]*\}', ' ').Trim()
    if ($plain.Length -eq 0 -and $block -notmatch 'aria-label|Tooltip') {
      $iconOnlyMissing += $f.Name
    }
  }
}
Check 'у иконочных кнопок есть aria-label или Tooltip' ($iconOnlyMissing.Count -eq 0) ($iconOnlyMissing -join ', ')

# ---------------------------------------------------------------------- 8
Write-Host "`n=== 8. Удалённые косплейные сущности не вернулись ===" -ForegroundColor Cyan
foreach ($banned in @('ROLE_LABELS', 'app-card-accent', 'status-dot')) {
  $hits = @($code | Where-Object { $_.Text -match [regex]::Escape($banned) })
  Check ("нет {0}" -f $banned.Trim()) ($hits.Count -eq 0) (($hits | ForEach-Object { "$($_.Path):$($_.Line)" }) -join ', ')
}
$parentHits = @($code | Where-Object { $_.Text -match "=== 'parent'|role = 'parent'|\bRoleParent\b" })
Check 'нет роли parent' ($parentHits.Count -eq 0) (($parentHits | ForEach-Object { "$($_.Path):$($_.Line)" }) -join ', ')

# ---------------------------------------------------------------------- 9
Write-Host "`n=== 9. Двухосевая модель не смешана ===" -ForegroundColor Cyan
$typesText = [System.IO.File]::ReadAllText((Join-Path $Root 'types.ts'))
Check 'Role содержит teen/standard/senior' ($typesText -match "export type Role = 'teen' \| 'standard' \| 'senior'")
Check 'Authority содержит owner/guardian/member' ($typesText -match "export type Authority = 'owner' \| 'guardian' \| 'member'")
Check 'есть PROFILE_LABELS' ($typesText -match 'export const PROFILE_LABELS')
Check 'есть AUTHORITY_LABELS' ($typesText -match 'export const AUTHORITY_LABELS')
Check 'FamilyInfo несёт обе оси' ($typesText -match 'authority: Authority' -and $typesText -match 'role: Role')

Write-Host ""
Write-Host ("=" * 56)
if ($script:fail -eq 0) {
  Write-Host ("ИТОГ: пройдено {0}, провалено 0" -f $script:pass) -ForegroundColor Green
} else {
  Write-Host ("ИТОГ: пройдено {0}, ПРОВАЛЕНО {1}" -f $script:pass, $script:fail) -ForegroundColor Red
}
Write-Host ("=" * 56)
exit $(if ($script:fail -eq 0) { 0 } else { 1 })
