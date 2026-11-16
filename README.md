# Walt Truman Factcheck Studio

Een eigen studio in de browser. Je plakt een link naar een social-media-video, de studio factcheckt de video, jij kijkt alles na, en daarna maakt de studio een korte video waarin de pop **Walt Truman** de factcheck presenteert.

> **Stand van zaken:** stap 1 (invoer) werkt. Analyse, factcheck en nakijken komen hierna, daarna pas stem, Walt en de videotemplate. Zie [`docs/plan.md`](docs/plan.md).

---

## 1. Installeren op een nieuwe laptop

Dit doe je één keer per laptop. Je hebt vier programma's nodig.

| Programma | Waarvoor | Mac | Windows |
| --- | --- | --- | --- |
| **Git** | Code ophalen van GitHub | Zit erin (anders: `xcode-select --install`) | [git-scm.com](https://git-scm.com/download/win) |
| **Node.js 20+** | Draait de studio | [nodejs.org](https://nodejs.org) (LTS-versie) | [nodejs.org](https://nodejs.org) (LTS-versie) |
| **ffmpeg** | Video lezen, knippen, beelden eruit halen | `brew install ffmpeg` | `winget install Gyan.FFmpeg` |
| **yt-dlp** *(optioneel)* | Video automatisch ophalen via de link | `brew install yt-dlp` | `winget install yt-dlp.yt-dlp` |

Op de Mac heb je voor `brew` eerst [Homebrew](https://brew.sh) nodig. Op Windows typ je deze commando's in **PowerShell**. Sluit het venster daarna en open het opnieuw, zodat de nieuwe programma's gevonden worden.

Haal daarna de code op en installeer de onderdelen:

```bash
git clone https://github.com/tdvanderziel-cloud/walt-truman-studio.git
```

```bash
cd walt-truman-studio
```

```bash
npm install
```

## 2. Sleutels invullen

API-sleutels zijn je wachtwoorden voor de betaalde diensten. Ze staan **alleen** in het bestand `.env` op je laptop, nooit in de code en nooit op GitHub.

1. Kopieer `.env.example` naar een nieuw bestand `.env` (Mac: `cp .env.example .env`, Windows: `copy .env.example .env`).
2. Open `.env` in een teksteditor en vul in:
   - `ANTHROPIC_API_KEY`: aanmaken op [platform.claude.com](https://platform.claude.com) → API keys.
   - `ELEVENLABS_API_KEY`: op [elevenlabs.io](https://elevenlabs.io) → je profiel → API keys.
3. Controleer of alles klaar is:

```bash
npm run check
```

Je ziet per onderdeel een ✅ of een ❌ met uitleg wat je moet doen.

## 3. De studio starten

```bash
npm run studio
```

Open daarna **http://localhost:4321** in je browser. Stoppen doe je met `Ctrl+C` in het terminalvenster.

## 4. Voorbeeld: één video van begin tot eind

*Wordt per stap aangevuld.*

1. **Link plakken** en op *Start* klikken. De studio probeert de video op te halen met yt-dlp.
   - Lukt het niet (privévideo, inloggen nodig, platform blokkeert), dan zie je dat in gewone taal en upload je het bestand zelf.
   - Wil je niet automatisch downloaden, vink dan *"Niet ophalen, ik upload het bestand zelf"* aan.
2. **Bron controleren.** Account (@naam) en datum van de post zijn verplicht, want die komen altijd in beeld ("Original: @account · datum"). Vul aan wat ontbreekt en klik *Bron opslaan*.
3. Staat er **"Klaar voor analyse"**, dan is stap 1 klaar.
4. *(volgt)* Analyse → factcheck → nakijken en goedkeuren → script en stem → video.

## Waar staat wat

| Map / bestand | Inhoud |
| --- | --- |
| `brand/` | Karakterblad, referentiebeelden, videotemplate en stem-instellingen van Walt. Dit is leidend. |
| `jobs/<datum>-<naam>/` | Alles van één video: `job.json` (bron, status, logboek), `original.mp4`, en later transcript, factcheck en eindvideo. |
| `server/` | De code achter de studio (TypeScript). |
| `public/` | De webpagina van de studio. |
| `docs/plan.md` | Het plan, de keuzes en de kostenschatting. |

### Twee laptops

De **code** gaat via GitHub, je **jobs** niet. De map `jobs/` staat bewust in `.gitignore`: hij bevat andermans video's en grote bestanden, die horen niet in een (ook al privé) repository. Wil je een job op je andere laptop hebben, kopieer de map dan via een USB-stick of cloudmap.

Bijwerken op de andere laptop:

```bash
git pull
```

```bash
npm install
```

## Wat mag wel en niet met andermans video?

- **Downloaden:** TikTok, Instagram en X verbieden automatisch downloaden in hun gebruiksvoorwaarden. YouTube ook, behalve via hun eigen functies. yt-dlp werkt technisch vaak wel, maar je overtreedt dan de voorwaarden van het platform. De veiligere route is de downloadknop van het platform zelf (als de maker die aan heeft staan) of een schermopname, en dan uploaden.
- **Gebruiken in jullie video:** in Nederland mag je een kort stuk citeren voor kritiek of commentaar (citaatrecht, art. 15a Auteurswet). Voorwaarden: alleen wat nodig is, met naamsvermelding van de maker, en jullie commentaar is de hoofdzaak.
- **Niet doen:** de hele video overnemen, een langer fragment gebruiken dan nodig, of het watermerk van de maker weghalen.
- Dit is geen juridisch advies. Twijfel je, laat het checken.

## Voor ontwikkelaars

```bash
npm test
```

```bash
npm run typecheck
```
