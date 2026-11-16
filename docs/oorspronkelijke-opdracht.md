# Prompt voor Claude Code: Walt Truman Factcheck Studio

Zet deze hele map `walt-truman-studio/` als basis van je project. Open Claude Code in die map en plak alles onder de streep als eerste bericht.

---

Ik wil een eigen productieomgeving bouwen: de **Walt Truman Factcheck Studio**. Ik plak een link naar een social-media-video, de studio factcheckt die video grondig, en maakt daarna een nieuwe korte video waarin onze vaste nieuwslezer, de pop Walt Truman, de factcheck presenteert. Ik ben beginner. Leg elke stap kort en simpel uit in het Nederlands. Code-commentaar mag Engels.

## Doel

Het maken van één factcheck-video moet zo makkelijk mogelijk zijn: link plakken, factcheck nakijken, op "maak video" klikken, klaar. Twee dingen staan boven alles:

1. **Betrouwbaarheid.** Een foute factcheck kost het merk zijn geloofwaardigheid. Liever eerlijk "nog onbekend" dan gokken.
2. **Transparantie.** Zowel in de factcheck (welke bronnen, waarom dit oordeel) als in de video (de kijker ziet altijd de originele video en de bronnen).

## Wat ik al heb (staat in `brand/`)

Lees deze bestanden eerst helemaal door. Ze zijn leidend voor alles wat je bouwt:

- `brand/character-sheet.jpg`: het officiële karakterblad van Walt Truman. Dit is de wet voor zijn uiterlijk.
- `brand/walt-truman-character-bible.md`: uiterlijk, persoonlijkheid, stem en vaste zinnen van Walt.
- `brand/video-template.md`: de opmaak van de video, de oordelen en hun kleuren.
- `brand/voice-settings.json`: de ElevenLabs-stem van Walt (voice_id `CJ8hAz66bFre2NXGRLvz`).
- `brand/walt-reference-front-interim.png` en `brand/walt-reference-34-interim.png`: tijdelijke referentiebeelden, uitgeknipt uit het karakterblad. Ik vervang ze door betere versies op groene achtergrond (`walt-reference-front.png`, `walt-reference-34.png`). Gebruik de nieuwe zodra ze er zijn.

## De stappen van de studio

### 1. Invoer
- Een veld waar ik een link plak (TikTok, Instagram, YouTube Shorts, X). Probeer de video op te halen (bijvoorbeeld met yt-dlp). Lukt dat niet, of mag het niet volgens de regels van het platform, dan kan ik het videobestand zelf uploaden. Leg me uit wat wel en niet mag.
- Sla per video een "job" op in een eigen map (`jobs/<datum>-<korte-naam>/`) met alle tussenresultaten, zodat alles terug te vinden is.
- Bewaar altijd de bron: link, naam van het account, datum van de post.

### 2. De video analyseren
- Transcribeer de gesproken tekst met tijdcodes (ElevenLabs speech-to-text of Whisper; stel voor wat het beste en goedkoopste is).
- Haal beelden uit de video (bijvoorbeeld elke 2 seconden plus bij scènewissels) en lees tekst in beeld uit.
- Laat Claude beschrijven wat er te zien is, en of er tekenen zijn van AI-gegenereerde of bewerkte beelden. Dat is altijd een inschatting, nooit een zeker oordeel.

### 3. Factchecken
- Haal de 1-3 belangrijkste controleerbare beweringen eruit, met tijdcode. Sla meningen, grappen en voorspellingen over.
- Zoek per bewering bronnen online. Voorkeur: primaire bronnen (officiële instanties, wetenschappelijke onderzoeken, gerenommeerde nieuwsmedia, erkende factcheckers). Geen forums of social media als hoofdbron.
- Oordeel per bewering op deze vaste schaal: **Klopt / Mist context / Misleidend / Onjuist / Nog onbekend**. In de (Engelstalige) video heten ze TRUE / MISSING CONTEXT / MISLEADING / FALSE / UNPROVEN (zie `brand/video-template.md`).
- Per bewering: korte uitleg in gewone taal, een betrouwbaarheidsinschatting, en 2-4 bronnen met titel, uitgever, datum en link.
- Spreken bronnen elkaar tegen, zeg dat dan. Kies niet zomaar één kant.
- Gaat het om net gebeurd nieuws met nog weinig betrouwbare bronnen, kies dan "Nog onbekend".
- Bewaar alles in `factcheck.json` én een leesbaar `factcheck.md`.

### 4. Nakijken door mij (verplicht)
- Toon de factcheck in een simpele webpagina: beweringen, oordelen, bronnen (klikbaar) en het script.
- Ik moet alles kunnen aanpassen en per bewering op "goedgekeurd" klikken. **Zonder mijn goedkeuring wordt er geen video gemaakt.**

### 5. Script schrijven in de stem van Walt
- Engels, 30-60 seconden, korte zinnen, makkelijk te volgen zonder geluid (want ondertitels).
- Vaste opbouw:
  1. **Hook (0-2 sec):** de claim, plus Walt die vraagt of het klopt.
  2. **De claim:** het stukje originele video waarin het gezegd wordt.
  3. **Het onderzoek:** wat de bronnen zeggen, met de bronnen in beeld.
  4. **Het oordeel:** een korte stilte, dan het oordeel, met de stempel.
  5. **Afsluiter:** "Tag us under a video you want checked." en "Sources in the description."
- Stijl: warm, droog, licht maf, met af en toe een vaste uitdrukking. Nooit spottend over de maker of de kijkers. Altijd: we checken de claim, niet de persoon.
- Maak een paar varianten van de hook, zodat ik kan kiezen.

### 6. Stem
- Genereer de audio met de ElevenLabs-stem van Walt (voice_id hierboven). Gebruik altijd dezelfde stem-instellingen en leg ze vast in `brand/voice-settings.json`.
- Maak een uitspraaklijst voor de naam Walt Truman en terugkerende woorden.
- Vaste zinnen (opening, de stempelzinnen per oordeel, afsluiter) één keer opnemen en hergebruiken.

### 7. Walt in beeld (het lastigste deel, leg de keuzes goed uit)
- Walt moet bewegen en praten op de audio (lipsync), met een **transparante achtergrond**, zodat hij over de originele video kan.
- Aanpak: genereer Walt op een egale chroma-groene achtergrond (#00FF00) op basis van de referentiebeelden, en haal het groen eruit (bijvoorbeeld met ffmpeg chromakey). Of gebruik een tool voor achtergrondverwijdering. Vergelijk de opties op kwaliteit, kosten en consistentie.
- Werk met een **bibliotheek van vaste bewegingsclips** (praten, knikken, over de bril kijken, verbaasd kijken, wegduiken, stempel zetten), zodat hij er in elke video hetzelfde uitziet. Alleen de lipsync en de audio zijn per video nieuw.
- Elke clip controleren tegen het karakterblad: gezicht, haar, koperen leesbril, blazer, speldje. Geen zichtbare staven tenzij ik dat wil.

### 8. Video opmaken (template)
- Formaat 1080x1920 (staand), 30 fps, MP4.
- **Achtergrond:** de originele video, over het hele beeld. Tijdens de uitleg van Walt mag die iets gedimd zijn of stilstaan, maar hij blijft altijd zichtbaar. Laat vooral de stukken zien waar de bewering in zit, niet de hele video als die lang is.
- **Walt:** linksonder in beeld, met transparante achtergrond, ongeveer 35-40% van de beeldhoogte, alsof hij van onderaf het beeld in komt.
- **Bovenin:** een balk met de claim in een paar woorden.
- **Altijd in beeld:** "Original: @account" met de datum, voor de transparantie.
- **Bronnen in beeld:** bij elke bron een kort kaartje met de naam van de uitgever en het jaar, terwijl Walt erover praat.
- **Oordeel:** een grote stempel met het Engelse label, elk in een vaste kleur (zie `brand/video-template.md`).
- **Ondertitels:** groot en duidelijk, woord voor woord meelopend, op een plek waar ze Walt en de stempel niet bedekken.
- Houd rekening met de zones waar TikTok en Instagram hun knoppen en tekst plaatsen.
- Bouw dit met een template-systeem waarmee ik later de opmaak makkelijk kan aanpassen. Stel voor wat het beste past (bijvoorbeeld Remotion of ffmpeg) en leg uit waarom.

### 9. Output per video
- `final.mp4`: de video.
- `description.txt`: een omschrijving om te plakken, met de claim, het oordeel in één zin, alle bronnen met links, een link naar de originele video, de vermelding van de maker en relevante hashtags.
- Een herinnering om bij het posten het AI-label aan te zetten.
- Een log met de kosten van deze video (AI, zoeken, stem, video) en hoe lang alles duurde.

## Technisch

- Begin met een simpele lokale webpagina als bediening (een "studio" in de browser). Geen inlog, geen betaalfuncties.
- API-sleutels in `.env` (in `.gitignore`), met een `.env.example` zonder echte sleutels.
- Zet het project in een privé GitHub-repository. Ik werk op twee laptops.
- Schrijf een README met: installeren op een nieuwe laptop, sleutels invullen, de studio starten, en een voorbeeld van één video van begin tot eind.

## Testen

- Maak een testset van 10 bekende virale claims waarvan het juiste oordeel vaststaat (een mix van waar, onwaar, misleidend en onbekend). Laat zien hoeveel de studio er goed heeft.
- Maak één complete testvideo van begin tot eind voordat we iets verfijnen.

## Regels en grenzen

- Gebruik van de video van iemand anders: alleen het deel dat nodig is voor de factcheck, met duidelijke bronvermelding van de maker en met ons commentaar als hoofdzaak. Waarschuw me als iets juridisch riskant lijkt. Ik check dit zelf ook nog.
- Nooit een oordeel over een persoon, alleen over een bewering.
- Check claims van alle politieke kanten. Houd in een simpel overzicht bij welke onderwerpen en kanten we gecheckt hebben.

## Hoe we werken

1. Stel me eerst vragen over wat nog onduidelijk is, voordat je code schrijft.
2. Laat een kort plan zien met de onderdelen, de volgorde, welke diensten en API's je wilt gebruiken, en een schatting van de kosten per video.
3. Bouw het in kleine stappen. Begin met stap 1 tot en met 4 (invoer, analyse, factcheck, nakijken) zonder video. Pas daarna de stem, Walt en de opmaak.
4. Na elke stap: wat heb je gedaan, hoe test ik het, en zet de wijziging op GitHub met een duidelijke beschrijving.
