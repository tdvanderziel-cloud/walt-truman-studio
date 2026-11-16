# Walt-clips

Vaste bewegingsclips van Walt, klaar om over de originele video te leggen.

| Bestand | Wat |
| --- | --- |
| `outro-tag-us.webm` | **Gebruiken.** Afsluiter: Walt zegt "Tag us under a video you want checked." en wijst naar de kijker. Transparante achtergrond (VP9 met alfa), 5 sec, 24 fps, 720x1280, met geluid. |
| `outro-tag-us-green.mp4` | Bron: zoals Higgsfield Intone hem maakte (met studiolampen op de achtergrond). |
| `outro-tag-us-black.mp4` | Tussenstap: achtergrond verwijderd door Higgsfield (zwart). |

## Zo maak je een nieuwe clip

1. Maak de clip in Higgsfield (bijv. Intone met een Walt-beeld uit `../expressions/` en een zin uit `../../voice/`).
2. Laat Higgsfield de achtergrond verwijderen ("remove background", video). Je krijgt Walt op zwart.
3. Maak hem transparant:

```bash
npm run key -- brand/walt/clips/<naam>-black.mp4 brand/walt/clips/<naam>.webm --black
```

4. De achtergrondverwijdering haalt het geluid weg. Zet het terug uit de originele clip (loopt precies gelijk met de mond):

```bash
ffmpeg -c:v libvpx-vp9 -i brand/walt/clips/<naam>.webm -i brand/walt/clips/<naam>-green.mp4 -map 0:v -map 1:a -c:v copy -c:a libopus -shortest brand/walt/clips/<naam>-final.webm
```

5. Controleer de clip tegen het karakterblad: gezicht, haar, koperen bril, blazer, speldje, geen staven.
