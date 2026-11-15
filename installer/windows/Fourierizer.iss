; Fourierizer for Windows: one installer with the instrument (VST3), Fourierizer Capture (VST3)
; and the Standalone app. Built by .github/workflows/release.yml with Inno Setup 6:
;   iscc /DAppVersion=2.0.0 /DBuildDir=..\..\build\release installer\windows\Fourierizer.iss
;
; Installing for all users (the default, needs admin) puts the plugins in
; C:\Program Files\Common Files\VST3, where FL Studio and every DAW look. Installing only for
; the current user puts them in %LOCALAPPDATA%\Programs\Common\VST3 (also a standard VST3 folder).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef BuildDir
  #define BuildDir "..\..\build\release"
#endif
#define Instrument BuildDir + "\plugin\Fourierizer_artefacts\Release"
#define Capture BuildDir + "\capture\FourierizerCapture_artefacts\Release"

[Setup]
AppId={{6F1C9C2E-7E4B-4C61-9B53-0F0A2E5B7D11}
AppName=Fourierizer
AppVersion={#AppVersion}
AppPublisher=waves_p
AppPublisherURL=https://github.com/polordi/fourierizer
DefaultDirName={autopf}\Fourierizer
DefaultGroupName=Fourierizer
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE
OutputDir=..\..\build\installer
OutputBaseFilename=Fourierizer-{#AppVersion}-Windows-Setup
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog commandline
WizardStyle=modern
UninstallDisplayName=Fourierizer {#AppVersion}

[Types]
Name: "full"; Description: "Everything"
Name: "custom"; Description: "Choose"; Flags: iscustom

[Components]
Name: "instrument"; Description: "Fourierizer (VST3 instrument)"; Types: full custom; Flags: fixed
Name: "capture"; Description: "Fourierizer Capture (VST3 effect: records a mixer track for Fourierizer)"; Types: full custom
Name: "app"; Description: "Fourierizer app (use it without a DAW)"; Types: full custom

[Files]
Source: "{#Instrument}\VST3\Fourierizer.vst3\*"; DestDir: "{autocf}\VST3\Fourierizer.vst3"; Components: instrument; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Capture}\VST3\Fourierizer Capture.vst3\*"; DestDir: "{autocf}\VST3\Fourierizer Capture.vst3"; Components: capture; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Instrument}\Standalone\Fourierizer.exe"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"
Source: "..\..\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; DestName: "THIRD_PARTY_NOTICES.txt"

[Icons]
Name: "{autoprograms}\Fourierizer"; Filename: "{app}\Fourierizer.exe"; Components: app
Name: "{autodesktop}\Fourierizer"; Filename: "{app}\Fourierizer.exe"; Components: app; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut for the app"; Components: app; Flags: unchecked

[Run]
Filename: "{app}\Fourierizer.exe"; Description: "Open the Fourierizer app"; Components: app; Flags: nowait postinstall skipifsilent unchecked
