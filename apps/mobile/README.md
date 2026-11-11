# Android development on Windows + WSL

Run the emulator and Android Studio on **Windows**. Keep the repository, Bun, Metro, Java, Gradle, and a separate **Linux Android SDK** inside WSL.

## Setup

- Install Android SDK tools on both systems; keep platform-tools versions aligned.
- Point WSL's `ANDROID_HOME` at its Linux SDK, never the Windows SDK directory.
- Enable `networkingMode=mirrored` under `[wsl2]` in Windows `%USERPROFILE%\.wslconfig`. Restart WSL after changing it.
- Start an AVD, such as `Pixel_9`, in Windows Android Studio's Device Manager.
- Start Windows ADB from PowerShell:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" start-server
```

Configure WSL fish, adjusting the Linux SDK location if needed:

```fish
set -gx ANDROID_HOME $HOME/Android/Sdk
set -gx ADB_SERVER_SOCKET tcp:127.0.0.1:5037
fish_add_path $ANDROID_HOME/platform-tools $ANDROID_HOME/cmdline-tools/latest/bin
```

Persist these settings in `~/.config/fish/config.fish`. `adb devices` in WSL should list the Windows emulator; `adb server-status` should report Windows `adb.exe`. Use one Windows ADB server for this setup.

## Run

From `apps/mobile`, in WSL:

```sh
bun run dev:android
```

This builds/installs the development client, reverses ports **3000, 3001, 8082**, and starts Metro. Device selection uses the ADB serial, so an unavailable emulator console name does not prevent startup.

For an already installed build, run `bun run reverse`, then `bun run android`. Reapply reverses after restarting the emulator. Start the web/API and auth services separately on ports 3000 and 3001; Metro alone cannot load the feed.

Shell settings and SDK installations are machine-local and are not committed.
