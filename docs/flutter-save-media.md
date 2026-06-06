# Flutter `saveMedia` bridge — save downloaded looks to the camera roll

The web app cannot write to the iOS/Android Photos library — browsers are
sandboxed. When a user downloads a look from **My Catalog**, the web code
(`app/utils/downloadLookVideo.ts` → `deliver()`) tries, in order:

1. **Native shell** — if running inside the Catalog Flutter app
   (`document.documentElement.dataset.shell === 'catalog-app'`), it calls a
   JS↔Flutter bridge handler named **`saveMedia`**. If that resolves truthy,
   the file went to Photos and we stop.
2. **Web share sheet** — otherwise (plain mobile browser), it offers a one-tap
   "Save to Photos" sheet that invokes `navigator.share({ files: [...] })`, so
   the user can pick **Save Video** → Photos.
3. **Download** — desktop / unsupported → a normal file download (Files).

For the **native app** to save straight to the camera roll, the Flutter side
must register the `saveMedia` handler. Until it does, step 1 is a no-op and the
app silently falls back to a download.

## Bridge contract

The web calls:

```js
window.flutter_inappwebview.callHandler('saveMedia', {
  filename: 'creator-catalog-2026-06-06.mp4',
  dataUrl:  'data:video/mp4;base64,AAAA…',   // the rendered, watermarked clip
  mime:     'video/mp4',
});
```

It expects the handler to **return `true`** on a successful save (anything
falsy / a throw makes the web fall back to the share/download path).

## Flutter implementation (flutter_inappwebview)

Add a gallery-saver dependency to the Flutter app (`catalog-flutter`):

```yaml
# pubspec.yaml
dependencies:
  image_gallery_saver: ^2.0.3   # or `saver_gallery` / `gal`
  path_provider: ^2.1.0
```

Register the handler when the webview is created (e.g. in
`lib/screens/feed_screen.dart`, near the other `addJavaScriptHandler` calls):

```dart
import 'dart:convert';
import 'dart:io';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:image_gallery_saver/image_gallery_saver.dart';
import 'package:path_provider/path_provider.dart';

// inside onWebViewCreated: (controller) { ... }
controller.addJavaScriptHandler(
  handlerName: 'saveMedia',
  callback: (args) async {
    try {
      final Map<String, dynamic> data = args.first as Map<String, dynamic>;
      final String filename = (data['filename'] ?? 'catalog-look.mp4') as String;
      final String dataUrl  = data['dataUrl'] as String;

      // Strip the "data:video/mp4;base64," prefix and decode.
      final int comma = dataUrl.indexOf(',');
      final String b64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
      final bytes = base64Decode(b64);

      // image_gallery_saver wants a real file path for video.
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$filename');
      await file.writeAsBytes(bytes, flush: true);

      final result = await ImageGallerySaver.saveFile(file.path, name: filename);

      // saveFile returns a Map like { isSuccess: true, filePath: ... }
      final ok = result is Map && (result['isSuccess'] == true);
      return ok;            // <-- web reads this; true == saved to Photos
    } catch (_) {
      return false;         // web falls back to its share/download path
    }
  },
);
```

### Permissions

- **iOS** — add to `ios/Runner/Info.plist`:
  ```xml
  <key>NSPhotoLibraryAddUsageDescription</key>
  <string>Save your looks to your camera roll.</string>
  ```
- **Android** — `image_gallery_saver` writes via `MediaStore` on API 29+; for
  older devices add `WRITE_EXTERNAL_STORAGE` to `AndroidManifest.xml`.

### Notes

- The payload is a **base64 data URL**, not a remote URL, because the clip is
  re-encoded client-side with the Catalog watermark before saving. For large
  clips consider switching the bridge to pass a temp blob URL the native side
  fetches, if data-URL size becomes a problem.
- Keep the handler name exactly `saveMedia` and the truthy-return contract —
  the web side keys off both (`app/utils/downloadLookVideo.ts`).
- Coordinate any change to this contract across both repos (see CLAUDE.md
  Section 8 — Flutter Shell / Native Webview Integration).
