# Moe Council Bridge v0.2 (test build)
A native Android companion for Pixel 10 Pro XL / Android 17. It is **not** a modification of ChatGPT.

## What to test
1. Install the debug APK from this branch's GitHub Actions artifact. Verify you trust the source.
2. Highlight text in Chrome or another standard editable app, look for **Send to Moe Council** in the selection menu.
3. Repeat in ChatGPT. Whether ChatGPT shows PROCESS_TEXT cannot be guaranteed.
4. Fallback: use ChatGPT **Copy**, add the **Send to Moe** Quick Settings tile (edit Quick Settings tile layout), tap tile, review clipboard import, then tap **Send to AI Council (Android Share)** and pick the existing installed Moe AI Council PWA.
5. Test accents, Arabic, long text, and no-text behavior.

## Security
No Internet permission, Accessibility access, overlay permission, background clipboard monitor, or auto-send. User must explicitly choose to share. Android may display standard clipboard-use indicators.

## Build
Requires JDK 17, Gradle 8.11.1, Android SDK API 35 / build-tools 35.0.0.
Run: `gradle :app:assembleDebug`.
Output: `app/build/outputs/apk/debug/app-debug.apk`.
This is a debug-signed APK, not a production release. Installing it requires Android's allow-from-this-source permission.

## Limitations
Android selection menu may omit third-party PROCESS_TEXT actions in ChatGPT; the user must test on the actual device. The Clipboard tile opens a foreground activity to comply with Android 10+ clipboard restrictions.
