param(
    [string]$KeystorePath = "L:\Meu Drive\Apps\Alo L42\android\alo-l42-debug.keystore"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$android = Join-Path $root "android"
$javaHome = "C:\Program Files\Android\Android Studio\jbr"
$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$gradle = Join-Path $android "gradlew.bat"

foreach ($required in @($javaHome, $sdk, $gradle, $KeystorePath)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Arquivo ou pasta necessária não encontrada: $required"
    }
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_KEYSTORE_PATH = $KeystorePath
$env:ANDROID_KEYSTORE_PASSWORD = "android"
$env:ANDROID_KEY_ALIAS = "alo-l42"
$env:ANDROID_KEY_PASSWORD = "android"

Push-Location $android
try {
    & $gradle --no-daemon clean :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "O Gradle não conseguiu gerar o APK." }
} finally {
    Pop-Location
}

$source = Join-Path $android "app\build\outputs\apk\release\app-release.apk"
$dist = Join-Path $root "dist"
$target = Join-Path $dist "Alo-Cozinha-v2.1.40.apk"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force

$apksigner = Get-ChildItem (Join-Path $sdk "build-tools") -Filter "apksigner.bat" -Recurse |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $apksigner) { throw "apksigner não foi encontrado no Android SDK." }

& $apksigner.FullName verify --verbose --print-certs $target
if ($LASTEXITCODE -ne 0) { throw "O APK foi gerado, mas a assinatura não passou na verificação." }

Write-Host "APK pronto: $target"
