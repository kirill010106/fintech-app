# Probe: is a self-chosen role an authorization boundary, or just a label?
# Pure ASCII on purpose so Windows PowerShell 5.1 reads it without a BOM.
param([string]$Base = 'http://localhost:8080/api/v1')

$ErrorActionPreference = 'Continue'

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
    $r = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $content = $r.ReadToEnd(); $r.Close(); $resp.Close()
  } catch [System.Net.WebException] {
    $wr = $_.Exception.Response
    if ($wr -ne $null) {
      $status = [int]$wr.StatusCode
      try { $r = New-Object System.IO.StreamReader($wr.GetResponseStream()); $content = $r.ReadToEnd(); $r.Close() } catch { $content = '' }
      $wr.Close()
    } else { $status = 0; $content = $_.Exception.Message }
  }
  $json = $null
  if ($content) { try { $json = $content | ConvertFrom-Json } catch { $json = $null } }
  return New-Object psobject -Property @{ Status = $status; Json = $json; Raw = $content }
}

function ToHash {
  param($Obj)
  $h = @{}
  if ($Obj) { $Obj.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value } }
  return $h
}

function Note {
  param([string]$Label, [string]$Text)
  Write-Host ("  {0,-6} {1}" -f $Label, $Text)
}

Write-Host "=== Sign-in as the seeded teen ===" -ForegroundColor Cyan
$teen = Call -Method POST -Path '/auth/login' -Body @{ email = 'artem@familybank.local'; password = 'password123' }
$teenToken = $teen.Json.data.access_token
$teenId = $teen.Json.data.user.id
$teenAcctId = $teen.Json.data.accounts[0].id
$parent = Call -Method POST -Path '/auth/login' -Body @{ email = 'alex@familybank.local'; password = 'password123' }
$parentToken = $parent.Json.data.access_token
$parentId = $parent.Json.data.user.id
Note 'INFO' ("teen id={0}, parent id={1}, same family={2}" -f $teenId, $parentId, ($teen.Json.data.family.id -eq $parent.Json.data.family.id))

$p0 = Call -Method GET -Path "/family/policies/$teenId" -Token $teenToken
$teenPolicyOriginal = ToHash $p0.Json.data
Note 'INFO' ("teen policy: require_co_signing={0} anti_dropper={1} night_lockdown={2} max={3}" -f `
  $teenPolicyOriginal['require_co_signing'], $teenPolicyOriginal['anti_dropper_shield'], `
  $teenPolicyOriginal['night_lockdown'], $teenPolicyOriginal['max_instant_transfer'])

# ---------------------------------------------------------------------------
Write-Host "`n=== Baseline: a transfer that the anti-fraud engine should stop ===" -ForegroundColor Cyan
$baseTr = Call -Method POST -Path '/transfers' -Token $teenToken -Body @{
  account_id = $teenAcctId; recipient_phone = '+79990000000'
  recipient_name = 'Crypto Exchange'; amount = 0.01; description = 'probe baseline'
}
Note 'INFO' ("baseline transfer status={0} requires_co_sign={1}" -f $baseTr.Status, $baseTr.Json.data.requires_co_sign)
$baseCoSignId = $baseTr.Json.data.co_sign_request_id

# ---------------------------------------------------------------------------
Write-Host "`n=== 1. Can the teen switch off his own supervision? ===" -ForegroundColor Cyan
$disabled = $teenPolicyOriginal.Clone()
$disabled['require_co_signing'] = $false
$disabled['anti_dropper_shield'] = $false
$disabled['night_lockdown'] = $false
$disabled['trusted_contacts_only'] = $false
$disabled['max_instant_transfer'] = 999999

$write = Call -Method PUT -Path "/family/policies/$teenId" -Token $teenToken -Body $disabled
Note ($(if ($write.Status -eq 200) { 'HOLE' } else { 'OK' })) ("teen PUT own policy -> {0}" -f $write.Status)

# The rejection itself is the security property. The stored flag may already be
# false from the seed, so the check is that the attempted escalation (max=999999,
# shields off) did not land, and that the engine still supervises the transfer.
$readBack = Call -Method GET -Path "/family/policies/$teenId" -Token $teenToken
Note ($(if ($readBack.Json.data.max_instant_transfer -eq 999999) { 'HOLE' } else { 'OK' })) `
  ("policy unchanged after refused edit: require_co_signing={0} anti_dropper={1} max={2}" -f `
    $readBack.Json.data.require_co_signing, $readBack.Json.data.anti_dropper_shield, $readBack.Json.data.max_instant_transfer)

$afterTr = Call -Method POST -Path '/transfers' -Token $teenToken -Body @{
  account_id = $teenAcctId; recipient_phone = '+79990000000'
  recipient_name = 'Crypto Exchange'; amount = 0.01; description = 'probe after disabling'
}
Note ($(if ($afterTr.Json.data.requires_co_sign -eq $false) { 'HOLE' } else { 'OK' })) `
  ("same transfer after disabling -> status={0} requires_co_sign={1}" -f $afterTr.Status, $afterTr.Json.data.requires_co_sign)

# ---------------------------------------------------------------------------
Write-Host "`n=== 2. Can the teen touch the parent's rules? ===" -ForegroundColor Cyan
$parentPolicy0 = Call -Method GET -Path "/family/policies/$parentId" -Token $parentToken
$parentOriginal = ToHash $parentPolicy0.Json.data
Note 'INFO' ("parent read as parent: status={0} max={1}" -f $parentPolicy0.Status, $parentOriginal['max_instant_transfer'])

$readParent = Call -Method GET -Path "/family/policies/$parentId" -Token $teenToken
Note ($(if ($readParent.Status -eq 200) { 'HOLE' } else { 'OK' })) ("teen GET parent policy -> {0}" -f $readParent.Status)

$parentEdited = $parentOriginal.Clone()
$parentEdited['max_instant_transfer'] = 424242
$writeParent = Call -Method PUT -Path "/family/policies/$parentId" -Token $teenToken -Body $parentEdited
Note ($(if ($writeParent.Status -eq 200) { 'HOLE' } else { 'OK' })) ("teen PUT parent policy -> {0}" -f $writeParent.Status)

$parentCheck = Call -Method GET -Path "/family/policies/$parentId" -Token $parentToken
Note ($(if ($parentCheck.Json.data.max_instant_transfer -eq 424242) { 'HOLE' } else { 'OK' })) `
  ("parent policy max after teen edit = {0}" -f $parentCheck.Json.data.max_instant_transfer)

# ---------------------------------------------------------------------------
Write-Host "`n=== 3. Is the authority self-declared at registration? ===" -ForegroundColor Cyan
# Registering no longer accepts a role at all. A person who creates their own
# family becomes its owner; a person who joins with a code becomes a member
# whose request the owner must confirm. Both are asserted below.
$stamp = Get-Date -Format 'MMddHHmmss'
$selfOwner = Call -Method POST -Path '/auth/register' -Body @{
  email = "selfowner.$stamp@example.com"; password = 'password123'
  name = 'Self Declared Parent'; phone = '+79001234567'
  birth_date = '1985-05-05'; role = 'parent'
  family_name = "Probe Family $stamp"
}
$ownerAuthority = $selfOwner.Json.data.family.authority
Note ($(if ($selfOwner.Status -eq 201 -and $ownerAuthority -eq 'owner') { 'OK' } else { 'HOLE' })) `
  ("register without invite -> {0}, authority={1}, profile={2}, invite={3}" -f `
    $selfOwner.Status, $ownerAuthority, $selfOwner.Json.data.family.role, $selfOwner.Json.data.family.invite_code)
Note ($(if ($selfOwner.Json.data.family.invite_code) { 'OK' } else { 'HOLE' })) `
  ("invite code is shown to the owner: {0}" -f [bool]$selfOwner.Json.data.family.invite_code)

$viaCode = Call -Method POST -Path '/auth/register' -Body @{
  email = "viacode.$stamp@example.com"; password = 'password123'
  name = 'Escalating Member'; phone = '+79001234568'
  birth_date = '2009-05-05'
  invite_code = $selfOwner.Json.data.family.invite_code
}
$joinedAuthority = $viaCode.Json.data.family.authority
$joinedStatus = $viaCode.Json.data.family.membership_status
Note ($(if ($viaCode.Status -eq 201 -and $joinedAuthority -eq 'member' -and $joinedStatus -eq 'pending') { 'OK' } else { 'HOLE' })) `
  ("register with invite -> {0}, authority={1}, status={2}, invite hidden={3}" -f `
    $viaCode.Status, $joinedAuthority, $joinedStatus, (-not $viaCode.Json.data.family.invite_code))

if ($viaCode.Json.data.access_token) {
  $memberToken = $viaCode.Json.data.access_token
  $memberRead = Call -Method GET -Path '/family/members' -Token $memberToken
  Note ($(if ($memberRead.Status -eq 403) { 'OK' } else { 'HOLE' })) `
    ("pending member GET /family/members -> {0}" -f $memberRead.Status)
  $memberInvite = Call -Method GET -Path '/family/invite' -Token $memberToken
  Note ($(if ($memberInvite.Status -eq 403) { 'OK' } else { 'HOLE' })) `
    ("pending member GET /family/invite -> {0}" -f $memberInvite.Status)
}

# ---------------------------------------------------------------------------
Write-Host "`n=== 4. Can anyone read a policy that is not theirs? ===" -ForegroundColor Cyan
$stranger = Call -Method GET -Path "/family/policies/$parentId" -Token $teenToken
Note ($(if ($stranger.Status -eq 403) { 'OK' } else { 'HOLE' })) `
  ("teen GET the owner's policy when the owner is not supervised -> {0}" -f $stranger.Status)

# ---------------------------------------------------------------------------
Write-Host "`n=== Restore probe changes ===" -ForegroundColor Cyan
$restoreTeen = Call -Method PUT -Path "/family/policies/$teenId" -Token $teenToken -Body $teenPolicyOriginal
Note 'INFO' ("teen policy restored -> {0}" -f $restoreTeen.Status)
if ($parentCheck.Json.data.max_instant_transfer -eq 424242) {
  $restoreParent = Call -Method PUT -Path "/family/policies/$parentId" -Token $teenToken -Body $parentOriginal
  Note 'INFO' ("parent policy restored -> {0}" -f $restoreParent.Status)
}
if ($baseCoSignId) {
  $rej = Call -Method POST -Path '/guardian/decide' -Token $parentToken -Body @{ request_id = $baseCoSignId; action = 'reject' }
  Note 'INFO' ("baseline co-sign request rejected -> {0}" -f $rej.Status)
}
$final = Call -Method GET -Path "/family/policies/$teenId" -Token $teenToken
Note 'INFO' ("teen policy final: require_co_signing={0} anti_dropper={1} max={2}" -f `
  $final.Json.data.require_co_signing, $final.Json.data.anti_dropper_shield, $final.Json.data.max_instant_transfer)

Write-Host "`nProbe finished." -ForegroundColor Gray
