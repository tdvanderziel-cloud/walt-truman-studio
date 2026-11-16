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

4. Controleer de clip tegen het karakterblad: gezicht, haar, koperen bril, blazer, speldje, geen staven.
