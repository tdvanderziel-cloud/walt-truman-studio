# Plan en keuzes

Afgesproken met de eigenaar (16 november 2026). De oorspronkelijke opdracht staat in [`oorspronkelijke-opdracht.md`](oorspronkelijke-opdracht.md).

## Keuzes

| Onderwerp | Keuze | Waarom |
| --- | --- | --- |
| Taal en techniek | TypeScript/Node voor alles | Eén taal; Remotion (video) is ook Node |
| Bediening | Lokale webpagina op `localhost:4321`, geen inlog | Simpel, alles blijft op de laptop |
| Video ophalen | yt-dlp, met upload als terugvaloptie | Zie het juridische stuk in de README |
| Transcriptie | ElevenLabs Scribe (woord-tijdcodes) | Goed in NL/EN, ~€0,01/min, account bestaat al |
| Analyse en factcheck | Claude Opus 5.5 + ingebouwde webzoekfunctie | Betrouwbaarheid gaat voor kosten |
| Taal factcheck | Nederlands (nakijkpagina, factcheck.md) | Voor de eigenaar |
| Taal video | Engels, stempel-labels Engels (TRUE / MISSING CONTEXT / MISLEADING / FALSE / UNPROVEN) | Volgt `brand/video-template.md` |
| Walt in beeld | Eerst route A ("digitale pop"), daarna route B testen | Zie hieronder |
| Videotemplate | Remotion, met ffmpeg voor het voorwerk | Opmaak is leesbare code, met een live voorbeeld |

### Walt: route A en B

- **A. Digitale pop.** Eén keer een bibliotheek van beelden en clips op chroma-groen (#00FF00), plus de drie mondstanden uit het karakterblad. De mond beweegt mee op de audio. Altijd exact hetzelfde uiterlijk, bijna gratis per video.
- **B. AI-lipsync.** Per video een AI-dienst die een clip uit de bibliotheek laat praten op de audio. Levendiger, ~€3-10 per video, en elke clip moet gecontroleerd worden tegen het karakterblad.

## Volgorde

1. ✅ Invoer: link of upload, job-map, broninformatie
2. ✅ Analyse: transcript, beelden plus tekst in beeld, beschrijving en een inschatting of de beelden AI/bewerkt zijn
3. ✅ Factcheck: `factcheck.json` en `factcheck.md`, plus een testset van 10 claims
4. ✅ Nakijkpagina: aanpassen en goedkeuren (verplicht)
5. Script en stem
6. Bibliotheek met Walt-clips
7. Videotemplate, `final.mp4`, `description.txt`, kostenlog, eerste testvideo

## Kostenschatting per video

| Post | Route A | Route B |
| --- | --- | --- |
| Claude (analyse en factcheck) | €1-2 | €1-2 |
| Webzoekopdrachten | ~€0,20 | ~€0,20 |
| Transcriptie | ~€0,01 | ~€0,01 |
| Stem | €0,20-0,40 | €0,20-0,40 |
| Lipsync | €0 | €3-10 |
| **Totaal** | **€1,50-3** | **€5-12** |

Eenmalig: ~€20-60 voor de bibliotheek met Walt-clips.

## Nog open

- `brand/walt-truman-character-bible.md` ontbreekt nog (nodig voor script en stem).
- Accountnaam van het merk (@…), platforms om op te posten, aantal video's per week, budget.
- Betere referentiebeelden op groen (`brand/walt-reference-front.png`, `brand/walt-reference-34.png`); tot die er zijn gebruiken we de `-interim` versies.
