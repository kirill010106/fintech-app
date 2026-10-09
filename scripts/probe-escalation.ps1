# Probe: can a family member self-declare as 'parent' using the family invite code?
# Pure ASCII so Windows PowerShell 5.1 reads it without a BOM.
param([string]$Base = 'http://localhost:8080/api/v1')

function Call {
  param([string]$Method, [string]$Path, $Body, [string]$Token)
  $req = [System.Net.HttpWebRequest]::Create("$Base$Path")
  $req.Method = $Method; $req.ContentType = 'application/json'; $req.Accept = 'application/json'; $req.Timeout = 20000
  if ($Token) { $req.Headers.Add('Authorization', "Bearer $Token") }
  if ($null -ne $Body) {
    $b = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))
    $req.ContentLength = $b.Length; $s = $req.GetRequestStream(); $s.Write($b,0,$b.Length); $s.Close()
  }
  $st=0; $c=''
  try { $r=$req.GetResponse(); $st=[int]$r.StatusCode; $sr=New-Object System.IO.StreamReader($r.GetResponseStream()); $c=$sr.ReadToEnd(); $sr.Close(); $r.Close() }
  catch [System.Net.WebException] { $wr=$_.Exception.Response; if($wr){ $st=[int]$wr.StatusCode; try{$sr=New-Object System.IO.StreamReader($wr.GetResponseStream()); $c=$sr.ReadToEnd(); $sr.Close()}catch{$c=''}; $wr.Close() } else { $c=$_.Exception.Message } }
  $j=$null; if($c){ try { $j=$c|ConvertFrom-Json } catch {} }
  return New-Object psobject -Property @{ Status=$st; Json=$j; Raw=$c }
}

$stamp = Get-Date -Format 'MMddHHmmss'

Write-Host "=== 1. The teen learns the family invite code (legitimately shown to parents) ===" -ForegroundColor Cyan
$parent = Call -Method POST -Path '/auth/login' -Body @{ email='alex@familybank.local'; password='password123' }
$parentToken = $parent.Json.data.access_token
$famId = $parent.Json.data.family.id
$code = $parent.Json.data.family.invite_code
Write-Host ("  family id={0}, invite code={1}" -f $famId, $code)

$teen = Call -Method POST -Path '/auth/login' -Body @{ email='artem@familybank.local'; password='password123' }
$teenToken = $teen.Json.data.access_token
$teenId = $teen.Json.data.user.id
Write-Host ("  teen id={0} in family {1}, family role={2}" -f $teenId, $teen.Json.data.family.id, $teen.Json.data.family.role)

Write-Host "`n=== 2. The teen registers a SECOND account with that code and tries to claim authority ===" -ForegroundColor Cyan
$escalated = Call -Method POST -Path '/auth/register' -Body @{
  email = "escalated.$stamp@example.com"; password = 'password123'
  name = 'Artem Second Account'; phone = '+79007654321'
  birth_date = '2009-01-01'; role = 'parent'
  invite_code = $code; family_name = 'Artem Own Family'
}
$gotAuthority = $escalated.Json.data.family.authority
$gotStatus = $escalated.Json.data.family.membership_status
$gotFamily = $escalated.Json.data.family.id
$verdict = if ($escalated.Status -eq 201 -and $gotAuthority -eq 'member' -and $gotStatus -eq 'pending') { 'OK' } else { 'HOLE' }
Write-Host ("  {0}  register(role=parent, invite) -> status={1}, family={2}, authority={3}, status={4}, invite hidden={5}" -f `
  $verdict, $escalated.Status, $gotFamily, $gotAuthority, $gotStatus, (-not $escalated.Json.data.family.invite_code))
Write-Host ("  {0}  own family was NOT created despite family_name being sent" -f `
  $(if ($gotFamily -eq $famId) { 'OK' } else { 'HOLE' }))

if ($escalated.Json.data.access_token) {
  $escToken = $escalated.Json.data.access_token
  $escId = $escalated.Json.data.user.id

  Write-Host "`n=== 3. Does that second account hold parent authority? ===" -ForegroundColor Cyan
  $inv = Call -Method GET -Path '/family/invite' -Token $escToken
  Write-Host ("  {0}  GET /family/invite as escalated account -> {1} (code={2})" -f `
    $(if ($inv.Status -eq 200) { 'HOLE' } else { 'OK' }), $inv.Status, $inv.Json.data.invite_code)

  $pending = Call -Method GET -Path '/guardian/pending' -Token $escToken
  Write-Host ("  {0}  GET /guardian/pending -> {1}, requests visible={2}" -f `
    'INFO', $pending.Status, @($pending.Json.data).Count)

  # Approve a pending request that the real parent should decide on.
  $tr = Call -Method POST -Path '/transfers' -Token $teenToken -Body @{
    account_id = $teen.Json.data.accounts[0].id; recipient_phone = '+79990000001'
    recipient_name = 'Crypto Exchange'; amount = 0.01; description = 'escalation probe'
  }
  $coSignId = $tr.Json.data.co_sign_request_id
  Write-Host ("  INFO  teen created co-sign request id={0} (requires_co_sign={1})" -f $coSignId, $tr.Json.data.requires_co_sign)

  if ($coSignId) {
    $approve = Call -Method POST -Path '/guardian/decide' -Token $escToken -Body @{ request_id = $coSignId; action = 'approve' }
    Write-Host ("  {0}  escalated account approved the teen's own transfer -> {1}" -f `
      $(if ($approve.Status -eq 200) { 'HOLE' } else { 'OK' }), $approve.Status)

    $audit = Call -Method GET -Path '/guardian/history' -Token $parentToken
    $mine = @($audit.Json.data | Where-Object { $_.id -eq $coSignId })
    if ($mine.Count -ge 1) {
      Write-Host ("  INFO  audit trail: status={0}, guardian_id={1} (real parent id={2})" -f `
        $mine[0].status, $mine[0].guardian_id, $parent.Json.data.user.id)
    }
  }

  Write-Host "`n=== 4. Can the escalated account re-issue the family invite code? ===" -ForegroundColor Cyan
  $rot = Call -Method POST -Path '/family/invite/regenerate' -Token $escToken
  Write-Host ("  {0}  regenerate invite as escalated account -> {1}" -f `
    $(if ($rot.Status -eq 200) { 'HOLE' } else { 'OK' }), $rot.Status)
}

Write-Host "`nProbe finished. Second account is left in place for inspection." -ForegroundColor Gray
Write-Host ("  email: escalated.{0}@example.com / password123" -f $stamp)
