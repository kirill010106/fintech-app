# Сквозная проверка fintech-app: auth, мультитенантность, квесты, со-подписание.
# Совместим с Windows PowerShell 5.1. Файл должен быть в UTF-8 с BOM.
# Запуск: powershell -ExecutionPolicy Bypass -File tmp\fintech-e2e-v3.ps1 -Base http://localhost:8080/api/v1
param(
  [string]$Base = 'http://localhost:8080/api/v1'
)

$ErrorActionPreference = 'Continue'
$script:pass = 0
$script:fail = 0
$script:skip = 0

function Call {
  param([string]$Method, [string]$Path, $Body, [string]$Token)

  $req = [System.Net.HttpWebRequest]::Create("$Base$Path")
  $req.Method = $Method
  $req.ContentType = 'application/json'
  $req.Accept = 'application/json'
  $req.Timeout = 20000
  $req.AllowAutoRedirect = $false
  if ($Token) { $req.Headers.Add('Authorization', "Bearer $Token") }

  if ($null -ne $Body) {
    $payload = $Body | ConvertTo-Json -Depth 8 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  }

  $status = 0
  $content = ''
  try {
    $resp = $req.GetResponse()
    $status = [int]$resp.StatusCode
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $content = $reader.ReadToEnd()
    $reader.Close(); $resp.Close()
  } catch [System.Net.WebException] {
    $webResp = $_.Exception.Response
    if ($webResp -ne $null) {
      $status = [int]$webResp.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($webResp.GetResponseStream())
        $content = $reader.ReadToEnd(); $reader.Close()
      } catch { $content = '' }
      $webResp.Close()
    } else { $status = 0; $content = $_.Exception.Message }
  }

  $json = $null
  if ($content) { try { $json = $content | ConvertFrom-Json } catch { $json = $null } }

  return New-Object psobject -Property @{ Status = $status; Json = $json; Raw = $content }
}

function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:pass++; Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("  FAIL  {0}  {1}" -f $Name, $Detail) -ForegroundColor Red }
}

function Skip {
  param([string]$Name, [string]$Why)
  $script:skip++
  Write-Host ("  SKIP  {0}  ({1})" -f $Name, $Why) -ForegroundColor Yellow
}

$stamp = Get-Date -Format 'MMddHHmmss'
$pw = 'password123'
Write-Host "База: $Base" -ForegroundColor Gray

# ================================================================ 1
Write-Host "`n=== 1. Регистрация владельца семьи ===" -ForegroundColor Cyan
$parentEmail = "parent.$stamp@test.local"
$r = Call -Method POST -Path '/auth/register' -Body @{
  email = $parentEmail; password = $pw; name = 'Тест Родитель'
  phone = '+79001112233'; birth_date = '1985-04-04'; family_name = "Тестовая семья $stamp"
}
Check '201 Created' ($r.Status -eq 201) "получено $($r.Status): $($r.Raw)"
$parentToken = $null; $parentFamId = $null; $inviteCode = $null
if ($r.Json -and $r.Json.data) {
  $parentToken = $r.Json.data.access_token
  $parentFamId = $r.Json.data.family.id
  $inviteCode = $r.Json.data.family.invite_code
}
Check 'выдан access_token' ([bool]$parentToken)
Check 'создана семья' ([bool]$parentFamId)
Check 'код приглашения — 6 символов' ($inviteCode -and $inviteCode.Length -eq 6) "код='$inviteCode'"
Check 'создан стартовый счёт' ($r.Json.data.accounts.Count -ge 1) "счетов: $($r.Json.data.accounts.Count)"
Check 'хэш пароля не утёк в ответ' ($r.Raw -notmatch 'pass_hash')
Check 'карта без старого бренда' ($r.Json.data.accounts[0].card_type -notmatch 'ВТБ') "card_type='$($r.Json.data.accounts[0].card_type)'"
Check 'создатель семьи стал владельцем' ($r.Json.data.family.authority -eq 'owner') "authority='$($r.Json.data.family.authority)'"
Check 'владелец не под защитой (профиль standard)' ($r.Json.data.family.role -eq 'standard') "profile='$($r.Json.data.family.role)'"
Check 'членство активно' ($r.Json.data.family.membership_status -eq 'active')

# ================================================================ 2
Write-Host "`n=== 2. Валидация регистрации ===" -ForegroundColor Cyan
$dup = Call -Method POST -Path '/auth/register' -Body @{
  email = $parentEmail; password = $pw; name = 'Дубликат'; phone = '+79000000000'; birth_date = '1990-01-01'
}
Check 'отказ на занятую почту' ($dup.Status -in 400, 409) "получено $($dup.Status)"

$shortEmail = "short.$stamp@test.local"
$short = Call -Method POST -Path '/auth/register' -Body @{
  email = $shortEmail; password = '123'; name = 'Короткий Пароль'; phone = '+79000000001'; birth_date = '1990-01-01'
}
Check 'отказ на пароль короче 8 символов' ($short.Status -eq 400) "получено $($short.Status): $($short.Raw)"

$breach = Call -Method POST -Path '/auth/login' -Body @{ email = $shortEmail; password = '123' }
Check 'аккаунт с коротким паролем не создан' ($breach.Status -eq 401) "получено $($breach.Status)"

$noBirth = Call -Method POST -Path '/auth/register' -Body @{
  email = "nobirth.$stamp@test.local"; password = $pw; name = 'Без Даты'; phone = '+79000000009'
}
Check 'отказ без даты рождения' ($noBirth.Status -eq 400) "получено $($noBirth.Status)"

$tooYoung = Call -Method POST -Path '/auth/register' -Body @{
  email = "young.$stamp@test.local"; password = $pw; name = 'Слишком Млад'; phone = '+79000000010'
  birth_date = (Get-Date).AddYears(-9).ToString('yyyy-MM-dd')
}
Check 'отказ младше 14 лет' ($tooYoung.Status -eq 400) "получено $($tooYoung.Status)"

$future = Call -Method POST -Path '/auth/register' -Body @{
  email = "future.$stamp@test.local"; password = $pw; name = 'Из Будущего'; phone = '+79000000011'
  birth_date = (Get-Date).AddYears(1).ToString('yyyy-MM-dd')
}
Check 'отказ на дату из будущего' ($future.Status -eq 400) "получено $($future.Status)"

$badcode = Call -Method POST -Path '/auth/register' -Body @{
  email = "bad.$stamp@test.local"; password = $pw; name = 'X'; phone = '+79000000002'
  birth_date = '2009-01-01'; invite_code = 'ZZZZZZ'
}
Check 'отказ на неверный код приглашения' ($badcode.Status -eq 400) "получено $($badcode.Status)"

$orphan = Call -Method POST -Path '/auth/register' -Body @{
  email = "bad.$stamp@test.local"; password = $pw; name = 'X'; phone = '+79000000002'; birth_date = '1990-01-01'
}
Check 'после отказа аккаунт не создан' ($orphan.Status -eq 201) "повторная регистрация дала $($orphan.Status)"

$badRole = Call -Method POST -Path '/auth/register' -Body @{
  email = "role.$stamp@test.local"; password = $pw; name = 'X'; phone = '+79000000003'
  birth_date = '1990-01-01'; role = 'admin'
}
Check 'поле role игнорируется (никакой эскалации)' ($badRole.Json.data.family.authority -eq 'owner') "authority='$($badRole.Json.data.family.authority)'"

# ================================================================ 3
Write-Host "`n=== 3. Сессия и защита эндпоинтов ===" -ForegroundColor Cyan
$me = Call -Method GET -Path '/auth/me' -Token $parentToken
Check 'GET /auth/me = 200' ($me.Status -eq 200) "получено $($me.Status)"
Check 'me вернул тот же invite_code' ($me.Json.data.family.invite_code -eq $inviteCode)

$noToken = Call -Method GET -Path '/auth/me'
Check '401 без токена' ($noToken.Status -eq 401) "получено $($noToken.Status)"

$junk = Call -Method GET -Path '/auth/me' -Token 'not-a-real-token'
Check '401 с мусорным токеном' ($junk.Status -eq 401) "получено $($junk.Status)"

# ================================================================ 4
Write-Host "`n=== 4. Подросток подаёт заявку по коду, владелец её подтверждает ===" -ForegroundColor Cyan
$teenEmail = "teen.$stamp@test.local"
$t = Call -Method POST -Path '/auth/register' -Body @{
  email = $teenEmail; password = $pw; name = 'Тест Подросток'
  phone = '+79002223344'; birth_date = '2009-05-05'; invite_code = $inviteCode
}
Check '201 Created' ($t.Status -eq 201) "получено $($t.Status): $($t.Raw)"
$teenToken = $null; $teenUserId = $null; $teenAcctId = $null
if ($t.Json -and $t.Json.data) {
  $teenToken = $t.Json.data.access_token
  $teenUserId = $t.Json.data.user.id
  $teenAcctId = $t.Json.data.accounts[0].id
}
Check 'подросток попал в ту же семью' ($t.Json.data.family.id -eq $parentFamId) "family=$($t.Json.data.family.id), ожидалось $parentFamId"
Check 'подросток стал участником' ($t.Json.data.family.authority -eq 'member') "authority='$($t.Json.data.family.authority)'"
Check 'членство ожидает подтверждения' ($t.Json.data.family.membership_status -eq 'pending') "status='$($t.Json.data.family.membership_status)'"
Check 'код приглашения скрыт от заявителя' (-not $t.Json.data.family.invite_code)

$pendingDenied = Call -Method GET -Path '/family/members' -Token $teenToken
Check 'заявитель не видит участников до подтверждения' ($pendingDenied.Status -eq 403) "получено $($pendingDenied.Status)"
$pendingInvite = Call -Method GET -Path '/family/invite' -Token $teenToken
Check 'заявитель не видит код приглашения' ($pendingInvite.Status -eq 403) "получено $($pendingInvite.Status)"

$reqs = Call -Method GET -Path '/family/requests' -Token $parentToken
$myReq = @($reqs.Json.data | Where-Object { $_.user.id -eq $teenUserId })
Check 'владелец видит заявку' ($reqs.Status -eq 200 -and $myReq.Count -eq 1) "status=$($reqs.Status), найдено=$($myReq.Count)"

$noReqAccess = Call -Method GET -Path '/family/requests' -Token $teenToken
Check 'заявитель не видит список заявок' ($noReqAccess.Status -eq 403) "получено $($noReqAccess.Status)"

$conf = Call -Method POST -Path '/family/requests/confirm' -Token $parentToken -Body @{
  user_id = $teenUserId; authority = 'member'; birth_date = '2009-05-05'
}
Check 'владелец подтвердил заявку' ($conf.Status -eq 200) "получено $($conf.Status): $($conf.Raw)"
Check 'права выданы владельцем' ($conf.Json.data.authority -eq 'member') "authority='$($conf.Json.data.authority)'"

$teenMe = Call -Method GET -Path '/auth/me' -Token $teenToken
Check 'профиль защиты выведен из даты рождения' ($teenMe.Json.data.family.role -eq 'teen') "profile='$($teenMe.Json.data.family.role)'"
Check 'членство стало активным' ($teenMe.Json.data.family.membership_status -eq 'active')

$teenSelfEdit = Call -Method PATCH -Path '/auth/profile' -Token $teenToken -Body @{ birth_date = '2005-01-01' }
Check 'участник не может менять дату рождения' ($teenSelfEdit.Status -eq 400) "получено $($teenSelfEdit.Status)"

# ================================================================ 5
Write-Host "`n=== 5. Вход по паролю ===" -ForegroundColor Cyan
$login = Call -Method POST -Path '/auth/login' -Body @{ email = $parentEmail; password = $pw }
Check 'login = 200' ($login.Status -eq 200) "получено $($login.Status)"
Check 'login вернул семью с кодом' ($login.Json.data.family.invite_code -eq $inviteCode)
if ($login.Json.data.access_token) { $parentToken = $login.Json.data.access_token }

$badLogin = Call -Method POST -Path '/auth/login' -Body @{ email = $parentEmail; password = 'wrong-password' }
Check '401 на неверный пароль' ($badLogin.Status -eq 401) "получено $($badLogin.Status)"

# ================================================================ 6
Write-Host "`n=== 6. Квесты начисляют награду ===" -ForegroundColor Cyan
$meBefore = Call -Method GET -Path '/auth/me' -Token $teenToken
$beforeBalance = [double]$meBefore.Json.data.accounts[0].balance
$beforeScore = [int]$meBefore.Json.data.user.safety_score

$quests = Call -Method GET -Path '/quests' -Token $teenToken
$questList = @($quests.Json.data)
Check 'квесты загружены' ($quests.Status -eq 200 -and $questList.Count -ge 1) "status=$($quests.Status), count=$($questList.Count)"

$expectedRub = 0.0
$expectedScore = 0
$firstQuestId = $null
$firstQuestCorrect = 0
foreach ($item in $questList) {
  if ($null -eq $firstQuestId) { $firstQuestId = $item.id; $firstQuestCorrect = $item.correct_option }
  $ans = Call -Method POST -Path "/quests/$($item.id)/answer" -Token $teenToken -Body @{ option_index = $item.correct_option }
  Check ("квест {0} принят и решён верно" -f $item.id) ($ans.Status -eq 200 -and $ans.Json.data.is_correct) "status=$($ans.Status): $($ans.Raw)"
  $expectedRub += [double]$item.reward_rub
  $expectedScore += [int]$item.safety_score_reward
}

$meAfter = Call -Method GET -Path '/auth/me' -Token $teenToken
$afterBalance = [double]$meAfter.Json.data.accounts[0].balance
$afterScore = [int]$meAfter.Json.data.user.safety_score

Check 'баланс вырос на сумму наград' ($afterBalance -eq ($beforeBalance + $expectedRub)) "было $beforeBalance, стало $afterBalance, ожидалось +$expectedRub"
Check 'баллы доверия выросли' ($afterScore -gt $beforeScore) "было $beforeScore, стало $afterScore"
Check 'квест помечен пройденным' ((@($meAfter.Json.data.accounts).Count -ge 1) -and ((Call -Method GET -Path '/quests' -Token $teenToken).Json.data | Where-Object { $_.id -eq $firstQuestId }).is_completed) 'нет'

$repeat = Call -Method POST -Path "/quests/$firstQuestId/answer" -Token $teenToken -Body @{ option_index = $firstQuestCorrect }
$meRepeat = Call -Method GET -Path '/auth/me' -Token $teenToken
$repeatBalance = [double]$meRepeat.Json.data.accounts[0].balance
Check 'повторный ответ не начисляет награду второй раз' ($repeatBalance -eq $afterBalance) "было $afterBalance, стало $repeatBalance"
Check 'повторный ответ помечен как пройденный' ($repeat.Json.data.already_completed -eq $true) "ответ: $($repeat.Raw)"

# ================================================================ 7
Write-Host "`n=== 7. Со-подписание подозрительного перевода ===" -ForegroundColor Cyan
$funded = $afterBalance
Check 'подросток может позволить перевод' ($funded -ge 100) "баланс $funded"

$tr = Call -Method POST -Path '/transfers' -Token $teenToken -Body @{
  account_id = $teenAcctId; recipient_phone = '+79990000000'
  recipient_name = 'Крипто-обменник'; amount = 100; description = 'Перевод'
}
Check 'перевод принят' ($tr.Status -in 200, 201) "получено $($tr.Status): $($tr.Raw)"
Check 'запрошено со-подтверждение' ($tr.Json.data.requires_co_sign -eq $true) "ответ: $($tr.Raw)"
$coSignId = $tr.Json.data.co_sign_request_id
Check 'есть co_sign_request_id' ([bool]$coSignId)
Check 'показана причина риска' ([bool]$tr.Json.data.warning_message) "warning_message пуст"

$pending = Call -Method GET -Path '/guardian/pending' -Token $parentToken
Check 'GET /guardian/pending = 200' ($pending.Status -eq 200) "получено $($pending.Status)"
$seen = @($pending.Json.data | Where-Object { $_.id -eq $coSignId })
Check 'запрос виден родителю' ($seen.Count -eq 1) "всего запросов: $(@($pending.Json.data).Count)"

$teenPending = Call -Method GET -Path '/guardian/pending' -Token $teenToken
$teenSees = @($teenPending.Json.data | Where-Object { $_.id -eq $coSignId })
Check 'подросток не видит запрос как свой' ($teenSees.Count -eq 0)

$foreign = Call -Method POST -Path '/transfers' -Token $parentToken -Body @{
  account_id = $teenAcctId; recipient_phone = '+79990000000'
  recipient_name = 'Чужой счёт'; amount = 10; description = 'Проба'
}
Check '403 при списании с чужого счёта' ($foreign.Status -eq 403) "получено $($foreign.Status)"

$hijack = Call -Method POST -Path '/guardian/decide' -Token $teenToken -Body @{ request_id = $coSignId; action = 'approve' }
Check '403 при решении за родителя' ($hijack.Status -eq 403) "получено $($hijack.Status)"

$dec = Call -Method POST -Path '/guardian/decide' -Token $parentToken -Body @{ request_id = $coSignId; action = 'reject' }
Check 'родитель отклонил перевод' ($dec.Status -eq 200) "получено $($dec.Status): $($dec.Raw)"

$afterReject = Call -Method GET -Path '/auth/me' -Token $teenToken
Check 'при отклонении баланс не изменился' ([double]$afterReject.Json.data.accounts[0].balance -eq $funded) "было $funded, стало $($afterReject.Json.data.accounts[0].balance)"

# ================================================================ 8
Write-Host "`n=== 8. Профиль и смена пароля ===" -ForegroundColor Cyan
$upd = Call -Method PATCH -Path '/auth/profile' -Token $teenToken -Body @{ name = 'Тест Подросток Обновлённый'; phone = '+79005556677' }
Check 'профиль обновлён (200)' ($upd.Status -eq 200) "получено $($upd.Status)"
Check 'имя изменено' ($upd.Json.data.user.name -eq 'Тест Подросток Обновлённый')
Check 'телефон изменён' ($upd.Json.data.user.phone -eq '+79005556677')

$emptyName = Call -Method PATCH -Path '/auth/profile' -Token $teenToken -Body @{ name = ''; phone = '+79005556677' }
Check 'отказ на пустое имя' ($emptyName.Status -eq 400) "получено $($emptyName.Status)"

$wrongPw = Call -Method POST -Path '/auth/password' -Token $teenToken -Body @{ current_password = 'nope'; new_password = 'newpassword123' }
Check '401 при неверном текущем пароле' ($wrongPw.Status -eq 401) "получено $($wrongPw.Status)"

$shortPw = Call -Method POST -Path '/auth/password' -Token $teenToken -Body @{ current_password = $pw; new_password = 'short' }
Check '400 на короткий новый пароль' ($shortPw.Status -eq 400) "получено $($shortPw.Status)"

$okPw = Call -Method POST -Path '/auth/password' -Token $teenToken -Body @{ current_password = $pw; new_password = 'newpassword123' }
Check 'пароль изменён (200)' ($okPw.Status -eq 200) "получено $($okPw.Status)"

$oldLogin = Call -Method POST -Path '/auth/login' -Body @{ email = $teenEmail; password = $pw }
Check 'старый пароль не работает' ($oldLogin.Status -eq 401) "получено $($oldLogin.Status)"

$newLogin = Call -Method POST -Path '/auth/login' -Body @{ email = $teenEmail; password = 'newpassword123' }
Check 'новый пароль работает' ($newLogin.Status -eq 200) "получено $($newLogin.Status)"

# ================================================================ 9
Write-Host "`n=== 9. Заявка на вступление после регистрации ===" -ForegroundColor Cyan
$solo = Call -Method POST -Path '/auth/register' -Body @{
  email = "solo.$stamp@test.local"; password = $pw; name = 'Одиночка'
  phone = '+79007778899'; birth_date = '2009-03-03'
}
Check 'одиночка зарегистрирован' ($solo.Status -eq 201) "получено $($solo.Status): $($solo.Raw)"
$soloToken = $solo.Json.data.access_token
$soloId = $solo.Json.data.user.id
Check 'у одиночки своя семья' ($solo.Json.data.family.id -ne $parentFamId)
Check 'одиночка владелец своей семьи' ($solo.Json.data.family.authority -eq 'owner')

$join = Call -Method POST -Path '/family/join' -Token $soloToken -Body @{ invite_code = $inviteCode }
Check 'join = 200' ($join.Status -eq 200) "получено $($join.Status): $($join.Raw)"
Check 'заявка помечена как ожидающая' ($join.Json.data.membership_status -eq 'pending') "ответ: $($join.Raw)"
Check 'в ответе имя целевой семьи' ($join.Json.data.family_name -eq "Тестовая семья $stamp") "family_name='$($join.Json.data.family_name)'"

$soloMe = Call -Method GET -Path '/auth/me' -Token $soloToken
Check 'одиночка теперь в семье владельца' ($soloMe.Json.data.family.id -eq $parentFamId) "family=$($soloMe.Json.data.family.id)"
Check 'одиночка ждёт подтверждения' ($soloMe.Json.data.family.membership_status -eq 'pending')

$again = Call -Method POST -Path '/family/join' -Token $soloToken -Body @{ invite_code = $inviteCode }
Check 'повторный join идемпотентен' ($again.Status -eq 200 -and $again.Json.data.membership_status -eq 'pending') "получено $($again.Status)"

$badJoin = Call -Method POST -Path '/family/join' -Token $soloToken -Body @{ invite_code = 'ZZZZZZ' }
Check '400 на неверный код при join' ($badJoin.Status -eq 400) "получено $($badJoin.Status)"

$reject = Call -Method DELETE -Path "/family/requests/$soloId" -Token $parentToken
Check 'владелец отклонил заявку (200)' ($reject.Status -eq 200) "получено $($reject.Status): $($reject.Raw)"

$soloAfterReject = Call -Method GET -Path '/auth/me' -Token $soloToken
Check 'после отказа членство снято' ($soloAfterReject.Json.data.family.id -ne $parentFamId) "family=$($soloAfterReject.Json.data.family.id)"

$notOwner = Call -Method DELETE -Path "/family/requests/$soloId" -Token $teenToken
Check 'участник не управляет заявками (403)' ($notOwner.Status -eq 403) "получено $($notOwner.Status)"

# ================================================================ 10
Write-Host "`n=== 10. Код приглашения: доступ и ротация ===" -ForegroundColor Cyan
$inv = Call -Method GET -Path '/family/invite' -Token $parentToken
Check 'владелец видит код (200)' ($inv.Status -eq 200) "получено $($inv.Status)"

$teenInv = Call -Method GET -Path '/family/invite' -Token $teenToken
Check 'участнику код недоступен (403)' ($teenInv.Status -eq 403) "получено $($teenInv.Status)"

$rot = Call -Method POST -Path '/family/invite/regenerate' -Token $parentToken
Check 'код перевыпущен (200)' ($rot.Status -eq 200) "получено $($rot.Status)"
Check 'новый код отличается' ($rot.Json.data.invite_code -ne $inviteCode) "было $inviteCode, стало $($rot.Json.data.invite_code)"

$staleJoin = Call -Method POST -Path '/auth/register' -Body @{
  email = "stale.$stamp@test.local"; password = $pw; name = 'По старому коду'
  phone = '+79009990011'; birth_date = '2009-01-01'; invite_code = $inviteCode
}
Check 'старый код больше не принимается' ($staleJoin.Status -eq 400) "получено $($staleJoin.Status)"

# ================================================================ 11
Write-Host "`n=== 11. Межсемейная изоляция ===" -ForegroundColor Cyan
$other = Call -Method POST -Path '/auth/register' -Body @{
  email = "other.$stamp@test.local"; password = $pw; name = 'Другая Семья'
  phone = '+79008889900'; birth_date = '1980-02-02'; family_name = 'Другая семья'
}
$otherToken = $other.Json.data.access_token
Check 'вторая семья создана' ($other.Status -eq 201) "получено $($other.Status)"

# 403 or 404 are both acceptable: the second family must not learn whether the
# user exists, and must never receive the policy itself.
$peek = Call -Method GET -Path "/family/policies/$teenUserId" -Token $otherToken
Check 'чужая семья не читает политику (403/404)' ($peek.Status -in 403, 404) "получено $($peek.Status)"
Check 'политика не утекла в ответ' ($peek.Raw -notmatch 'max_instant_transfer|trusted_whitelist') 'ответ содержит поля политики'

$own = Call -Method GET -Path "/family/policies/$teenUserId" -Token $parentToken
Check 'своя семья читает политику (200)' ($own.Status -eq 200) "получено $($own.Status)"

$self = Call -Method GET -Path "/family/policies/$teenUserId" -Token $teenToken
Check 'сам пользователь читает свою политику (200)' ($self.Status -eq 200) "получено $($self.Status)"

$crossDash = Call -Method GET -Path '/family/dashboard' -Token $otherToken
Check 'dashboard чужой семьи не содержит нашу' ($crossDash.Json.data.family.id -ne $parentFamId) "family=$($crossDash.Json.data.family.id)"

$ourDash = Call -Method GET -Path '/family/dashboard' -Token $parentToken
$ourIds = @($ourDash.Json.data.members | ForEach-Object { $_.member.user_id })
Check 'в нашей семье только свои участники' (-not ($ourIds -contains $other.Json.data.user.id)) "участники: $($ourIds -join ',')"

# ================================================================ 12
Write-Host "`n=== 12. Демо-эндпоинты удалены ===" -ForegroundColor Cyan
$removed = @(
  @{ m = 'GET';  p = '/users' },
  @{ m = 'POST'; p = '/auth/switch?user_id=1' },
  @{ m = 'POST'; p = '/demo/reset' },
  @{ m = 'POST'; p = '/demo/simulate-threat' }
)
foreach ($item in $removed) {
  $res = Call -Method $item.m -Path $item.p
  Check ("{0} {1} -> 404/405" -f $item.m, $item.p) ($res.Status -in 404, 405) "получено $($res.Status)"
}

# ================================================================ 13
Write-Host "`n=== 13. Выход ===" -ForegroundColor Cyan
$lo = Call -Method POST -Path '/auth/logout' -Token $parentToken
Check 'logout = 200' ($lo.Status -eq 200) "получено $($lo.Status)"

$anon = Call -Method POST -Path '/auth/logout'
Check '401 на logout без токена' ($anon.Status -eq 401) "получено $($anon.Status)"

Write-Host ""
Write-Host ("=" * 56)
if ($script:fail -eq 0) {
  Write-Host ("ИТОГ: пройдено {0}, пропущено {1}, провалено 0" -f $script:pass, $script:skip) -ForegroundColor Green
} else {
  Write-Host ("ИТОГ: пройдено {0}, пропущено {1}, ПРОВАЛЕНО {2}" -f $script:pass, $script:skip, $script:fail) -ForegroundColor Red
}
Write-Host ("=" * 56)
exit $(if ($script:fail -eq 0) { 0 } else { 1 })
