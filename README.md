# Moe Council Bridge v0.3 (Android 17 test)
An on-device review-and-share companion. It cannot modify ChatGPT's selection toolbar.

## Fast workflow
1. Install the Moe AI Council PWA using Chrome's "Install app" menu: https://moe-ai-council.lovable.app/
2. Install the Bridge v0.3 APK from GitHub Actions.
3. In the Bridge, tap "Add Send to Moe Quick Settings tile" and approve Android's tile request.
4. In ChatGPT, select text then tap Copy.
5. Swipe to Quick Settings, tap Send to Moe. The Bridge imports the clipboard only after entering the foreground.
6. Review or edit, then tap Send to AI Council. If an installed Council sharing target is detected, Android opens it directly. If not, select Council in the Android Share sheet.
7. In Council, ask Claude/Gemini/Grok together and copy their review back to ChatGPT.

"Find / remember Council app" pairs with a detected Council sharing target; "Use Android Share instead" is a fallback. "Open Council website" does not append clipboard text to a URL. If the PWA was only bookmarked, install it as an app for Android share target support.

## Privacy and limits
No Internet, Accessibility, overlay or background clipboard permissions. No automatic outbound sharing. The screen's contents are held in memory only (apart from Android's transient saved instance state). Only the chosen target component name is persisted. Text is limited to 30,000 characters for Council. Test against a real Pixel 10 Pro XL running Android 17.

## Build
JDK 17, Gradle 8.11.1, Android SDK API 35/build tools 35.0.0. Build command: gradle --no-daemon :app:assembleDebug. Result: app/build/outputs/apk/debug/app-debug.apk.
This is debug-signed. If the new GitHub-runner signing key differs from v0.2, Android will require uninstalling v0.2 before installing v0.3.
