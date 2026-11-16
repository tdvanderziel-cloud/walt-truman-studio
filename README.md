# Walt Truman Factcheck Studio

Een eigen studio in de browser. Je plakt een link naar een social-media-video, de studio factcheckt de video, jij kijkt alles na, en daarna maakt de studio een korte video waarin de pop **Walt Truman** de factcheck presenteert.

> **Stand van zaken:** stap 1 t/m 4 werken: invoer, analyse, factcheck en nakijken. Daarna komen script, stem, Walt en de videotemplate. Zie [`docs/plan.md`](docs/plan.md).

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

> **Windows: foutmelding "running scripts is disabled on this system"?** Windows blokkeert standaard scripts in PowerShell, en `npm` is zo'n script. Voer dit één keer uit in PowerShell en typ `J` (of `Y`) als het gevraagd wordt:
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
>
> Dit staat scripts toe die op je eigen computer staan, en alleen voor jouw gebruikersaccount. Sluit PowerShell en open het opnieuw.

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
   - `ELEVENLABS_API_KEY`: op [elevenlabs.io](https://elevenlabs.io) → **Developers** → **API keys**. Geef de sleutel deze toestemmingen: **Speech to Text**, **Text to Speech** en **Voices (lezen)**. Zonder die toestemmingen weigert ElevenLabs de opdracht.
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
4. **Analyse starten** (stap 2). Dit duurt meestal 1-3 minuten en kost ongeveer $0,20-1. De studio doet dan het volgende:
   - het geluid uit de video halen en uitschrijven met tijden (ElevenLabs Scribe);
   - elke paar seconden en bij elke scènewissel een beeld uit de video halen (ffmpeg);
   - Claude laten beschrijven wat er te zien en te horen is, alle tekst in beeld uitlezen, en inschatten of de beelden AI-gegenereerd of bewerkt zijn. Dat laatste is altijd een inschatting, nooit een zeker oordeel.

   Klik op een tijd (bijvoorbeeld `00:12.4`) om naar dat moment in de video te springen. Alles wordt ook bewaard in de job-map: `transcript.txt`, `frames/`, `analysis.json` en het leesbare `analysis.md`. De kosten staan in `job.json`.
5. **Factcheck starten** (stap 3). Dit duurt een paar minuten en kost ongeveer $0,50-2. De studio doet dan het volgende:
   - de 1-3 belangrijkste controleerbare beweringen kiezen (meningen, grappen en voorspellingen worden overgeslagen, met de reden erbij);
   - per bewering online zoeken, de belangrijkste bronnen openen en lezen, en een onderzoeksverslag schrijven;
   - een oordeel geven: **Klopt / Mist context / Misleidend / Onjuist / Nog onbekend**, met uitleg, betrouwbaarheid en 2-4 bronnen.

   **Ingebouwde veiligheidsregels** (in de code, niet alleen in de instructies aan Claude):
   - een bron telt alleen als de link echt in de zoekresultaten stond, zodat een verzonnen link wordt verwijderd;
   - social media en forums tellen nooit als bron;
   - minder dan 2 bruikbare bronnen, of recent nieuws met lage betrouwbaarheid, wordt automatisch **Nog onbekend**.

   Wat er automatisch is veranderd, zie je in een geel blok bij de bewering.
6. **Nakijken en goedkeuren** (stap 4, verplicht). Pas aan wat nodig is: bewering, oordeel, uitleg, bronnen, de tekst voor de balk bovenin de video, en het fragment (begin en eind in seconden). Klik dan per bewering op **Goedkeuren**.
   - Pas je na goedkeuring nog iets aan, dan vervalt de goedkeuring.
   - Zolang niet alles is goedgekeurd, staat er 🔒 en kan er geen video gemaakt worden.
   - Alles staat ook in `factcheck.md` (leesbaar) en `factcheck.json`.
7. *(volgt)* Script en stem → Walt → video.

### Overzicht onderwerpen en kanten

Klik links op **Overzicht onderwerpen en kanten**. Daar zie je welke onderwerpen en welke politieke lading we tot nu toe gecheckt hebben, zodat we alle kanten even kritisch bekijken.

### Testset: hoe goed is de factcheck?

In `eval/claims.json` staan 10 bekende virale beweringen waarvan het juiste oordeel vaststaat: waar, onwaar, misleidend, mist context en nog onbekend. Je draait ze zo:

```bash
npm run eval
```

Je ziet per bewering of de studio het goed had, en een score (bijvoorbeeld "9 van 10 goed"). Het verslag komt in `eval/results-<datum>.md`. Dit kost ongeveer $5-10. Eén bewering testen kan ook:

```bash
npm run eval -- --only=great-wall
```

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
