# บัตรรับรอง ABP · THAI Flight Training

Static site for the university cabin-safety class. Students open it from a QR code, drop their photo into a boarding-pass frame, and save an ABP certificate (Able-Bodied Passenger / ผู้โดยสารอาสา). The photo never leaves the phone.

GitHub Pages: branch `main`, folder `/` (repository root). No build step. [`.nojekyll`](.nojekyll) is included so Pages serves the font files and the deck as-is.

Live path: `https://esk8bkk.github.io/abp-certificate/`

## Pages

| Path | What it is |
|---|---|
| `/` | Frame maker. Three frames, pan/zoom, download PNG. |
| `/deck/` | Instructor slide deck, published unchanged. |
| `/qr/abp-certificate-qr.png` | QR for the maker (error correction H). |
| `/qr/deck-qr.png` | QR for the deck. |
| `/specs.json` | Photo window and text fields, in pixels. |

## Frames

Personal portrait (1080×1350), personal story (1080×1920), and group landscape (1920×1080). Overlays in `assets/frames/` already contain the labels, logo, stamp, and decorative barcode. The page draws only the photo and the field values, in the order in `specs.json`.

Values use self-hosted [Sarabun](https://fonts.google.com/specimen/Sarabun) (weights 500–800, OFL). Drawing waits for `document.fonts.ready`.

## Privacy

The maker has no upload, no analytics, no cookies, and no third-party requests. Export is a PNG built in the browser.

On iPhone Safari the download attribute is unreliable. The page opens the image in a save sheet and, when the browser allows it, the system share sheet (`navigator.share` with a PNG file) so the photo can be saved to Photos. Android Chrome uses the normal download.

## Instructor deck

`deck/index.html` is the original self-contained deck. It is not rewritten by this site. The deck itself links to YouTube and loads Sarabun from Google Fonts; the certificate page does not.
