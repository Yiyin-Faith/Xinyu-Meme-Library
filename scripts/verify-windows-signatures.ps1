param([string]$OutputDirectory = 'release/PC')
$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
$publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path -LiteralPath 'docs/windows-signing-certificate.cer').Path)
$files = @((Join-Path $OutputDirectory "Xinyu-Meme-Library-$version-Setup.exe"),(Join-Path $OutputDirectory 'win-unpacked/xinyu-meme-library.exe'))
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $publicCertificate.Thumbprint) { throw "Unexpected or missing signing certificate: $file" }
  if ($signature.Status -notin @('Valid', 'NotTrusted', 'UnknownError')) { throw "Invalid file signature: $file ($($signature.Status))" }
  Write-Output "$file : signer=$($signature.SignerCertificate.Subject); trust=$($signature.Status)"
}
$info = (Get-Item -LiteralPath $files[1]).VersionInfo
if ($info.ProductVersion -notlike "$version*" -or $info.ProductName -ne '心语表情库') { throw 'Application version resources are incorrect' }
Write-Output 'Self-signed certificate verified. Public SmartScreen trust still requires a CA or signing service.'
