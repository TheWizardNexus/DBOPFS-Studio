# DBOPFS Studio promo video

`dbopfs-studio-promo-1080p.mp4` is a 1920×1080, 30 fps H.264/AAC promotional
spot rendered from the shipped DBOPFS Studio demonstration interface and the
tracked browser-store screenshots. `dbopfs-studio-promo-poster.png` is its
matching 1920×1080 poster frame.
`dbopfs-studio-youtube-thumbnail-1280x720.png` is the dedicated YouTube and
README cover, `youtube-copy.md` contains copy-ready publishing metadata, and
`dbopfs-studio-promo.en.vtt` contains timed English jingle captions.

[Watch the published video on YouTube](https://youtu.be/y8FlLBzy-RU).

Regenerate the video, poster, and YouTube thumbnail from the repository root:

```sh
npm run promo:video
```

The renderer requires a local Chromium browser, `ffmpeg`, and `ffprobe`. It
uses the repository's existing `puppeteer-core` dependency and adds no new npm
dependency. It holds each rendered 1920×1080 scene plate completely still and
connects scenes with short cross-fades.

The soundtrack source is
`source/dbopfs-studio-retro-jingle.wav`, supplied by the repository owner. Its
embedded metadata identifies it as created with Suno. The repository owner
confirmed it was generated while their paid Suno account was active and that
they performed its vocal. Retain the applicable account and generation records
with the release evidence.

The UI records and `studio.demo.local` origin shown in the captured artwork are
fictional. The interface is the shipped Studio UI. The promo does not imply a
browser-store publication; installation and availability remain as described
in the main README and product site.
