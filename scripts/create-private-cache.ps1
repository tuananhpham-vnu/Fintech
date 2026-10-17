param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
$taskCachePath=[IO.Path]::GetFullPath($Path)
if(-not [IO.Path]::IsPathRooted($Path) -or $taskCachePath -eq [IO.Path]::GetPathRoot($taskCachePath) -or
  $taskCachePath -match '\\(?:\.git|public)(?:\\|$)' -or (Test-Path -LiteralPath $taskCachePath)) {
  throw 'Choose a new absolute private directory outside public hosting; existing directories are never modified.'
}
New-Item -ItemType Directory -Path $taskCachePath | Out-Null
$taskCurrentIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().User
$taskCacheAcl=New-Object Security.AccessControl.DirectorySecurity
$taskCacheAcl.SetOwner($taskCurrentIdentity)
$taskCacheAcl.SetAccessRuleProtection($true,$false)
foreach($taskPrincipalSid in @($taskCurrentIdentity.Value,'S-1-5-18','S-1-5-32-544')) {
  $taskSid=New-Object Security.Principal.SecurityIdentifier($taskPrincipalSid)
  $taskRule=New-Object Security.AccessControl.FileSystemAccessRule($taskSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $taskCacheAcl.AddAccessRule($taskRule)
}
[IO.Directory]::SetAccessControl($taskCachePath,$taskCacheAcl)
Write-Output 'Private cache directory provisioned. API startup performs additional ownership/path checks.'
