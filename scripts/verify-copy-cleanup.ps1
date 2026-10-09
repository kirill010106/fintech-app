# Проверка эффекта миграции 00005 на живых данных.
# ASCII+UTF8, требует BOM (PowerShell 5.1 иначе ломает кириллицу).
param([string]$Base = 'http://localhost:8080/api/v1')

function Call {
  param([string]$Method, [string]$Path, $Body, [string]$Token)
  $req = [System.Net.HttpWebRequest]::Create("$Base$Path")
  $req.Method = $Method
  $req.ContentType = 'application/json'
  $req.Accept = 'application/json'
  $req.Timeout = 20000
  if ($Token) { $req.Headers.Add('Authorization', "Bearer $Token") }
  if ($null -ne $Body) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  }
  $status = 0; $content = ''
  try {
    $resp = $req.GetResponse()
    $status = [int]$resp.StatusCode
    $r = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $content = $r.ReadToEnd(); $r.Close(); $resp.Close()
  } catch [System.Net.WebException] {
    $wr = $_.Exception.Response
    if ($wr -ne $null) {
      $status = [int]$wr.StatusCode
      try { $r = New-Object System.IO.StreamReader($wr.GetResponseStream(), [System.Text.Encoding]::UTF8); $content = $r.ReadToEnd(); $r.Close() } catch { $content = '' }
      $wr.Close()
    } else { $status = 0; $content = $_.Exception.Message }
  }
  $json = $null
  if ($content) { try { $json = $content | ConvertFrom-Json } catch { $json = $null } }
  return New-Object psobject -Property @{ Status = $status; Json = $json; Raw = $content }
}

$bad = 0
function Check { param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green }
  else { $script:bad++; Write-Host ("  FAIL  {0}  {1}" -f $Name, $Detail) -ForegroundColor Red }
}

Write-Host "=== Сид-пользователи после миграции 00005 ===" -ForegroundColor Cyan
$alex = Call -Method POST -Path '/auth/login' -Body @{ email = 'alex@familybank.local'; password = 'password123' }
Check 'вход по новому адресу alex@familybank.local' ($alex.Status -eq 200) "получено $($alex.Status)"
Check 'имя без демо-подписи "(Отец)"' ($alex.Json.data.user.name -eq 'Алексей Смирнов') "имя='$($alex.Json.data.user.name)'"

$artem = Call -Method POST -Path '/auth/login' -Body @{ email = 'artem@familybank.local'; password = 'password123' }
Check 'вход по artem@familybank.local' ($artem.Status -eq 200) "получено $($artem.Status)"
Check 'имя без "(Сын, 16 лет)"' ($artem.Json.data.user.name -eq 'Артём Смирнов') "имя='$($artem.Json.data.user.name)'"
$acct = $artem.Json.data.accounts[0]
Check 'card_type без бренда' ($acct.card_type -eq 'Юниор Digital') "card_type='$($acct.card_type)'"
Check 'bank_provider нормализован' ($acct.bank_provider -eq 'familybank') "bank_provider='$($acct.bank_provider)'"
Check 'баланс восстановлен' ([double]$acct.balance -eq 4850) "баланс=$($acct.balance)"

$nina = Call -Method POST -Path '/auth/login' -Body @{ email = 'nina@familybank.local'; password = 'password123' }
Check 'вход по nina@familybank.local' ($nina.Status -eq 200) "получено $($nina.Status)"
Check 'имя без "(Бабушка)"' ($nina.Json.data.user.name -eq 'Нина Смирнова') "имя='$($nina.Json.data.user.name)'"
Check 'пенсионная карта без бренда' ($nina.Json.data.accounts[0].card_type -notmatch 'ВТБ' -and $nina.Json.data.accounts[0].card_type.Length -gt 0) "card_type='$($nina.Json.data.accounts[0].card_type)'"

Write-Host "`n=== Старые адреса больше не работают ===" -ForegroundColor Cyan
$old = Call -Method POST -Path '/auth/login' -Body @{ email = 'alex@vtb.family'; password = 'password123' }
Check 'alex@vtb.family отклонён' ($old.Status -eq 401) "получено $($old.Status)"

Write-Host "`n=== Содержимое квестов и белый список ===" -ForegroundColor Cyan
$quests = Call -Method GET -Path '/quests' -Token $artem.Json.data.access_token
$q1 = @($quests.Json.data | Where-Object { $_.id -eq 1 })[0]
Check 'квест 1 переименован' ($q1.title -eq 'Сомнительная подработка в мессенджере') "title='$($q1.title)'"
$questRaw = $quests.Raw
Check 'в квестах нет ссылок на 161-ФЗ' ($questRaw -notmatch '161-ФЗ') 'найдено 161-ФЗ'
Check 'в квестах нет ссылок на 115-ФЗ' ($questRaw -notmatch '115-ФЗ') 'найдено 115-ФЗ'
Check 'в квестах нет ссылок на ЦБ РФ' ($questRaw -notmatch 'ЦБ РФ') 'найдено ЦБ РФ'
Check 'в квестах нет слова "дроппер"' ($questRaw -notmatch 'дроппер') 'найдено "дроппер"'

$policy = Call -Method GET -Path "/family/policies/$($artem.Json.data.user.id)" -Token $artem.Json.data.access_token
$wl = @($policy.Json.data.trusted_whitelist)
Check 'белый список без демо-имён' (-not ($wl -join ' ' -match 'Бабушка Нина|Репетитор Анна')) "whitelist=$($wl -join ' | ')"

Write-Host "`n=== Ответы бэкенда без регуляторного косплея ===" -ForegroundColor Cyan
$all = @($alex.Raw, $artem.Raw, $nina.Raw, $questRaw, $policy.Raw) -join ' '
Check 'нигде нет 161-ФЗ/115-ФЗ/ЦБ РФ/ВТБ' ($all -notmatch '161-ФЗ|115-ФЗ|ЦБ РФ|ВТБ') 'найдены следы'

Write-Host ""
if ($bad -eq 0) { Write-Host "ИТОГ: миграция применилась, все проверки пройдены" -ForegroundColor Green }
else { Write-Host ("ИТОГ: провалено {0}" -f $bad) -ForegroundColor Red }
exit $bad
