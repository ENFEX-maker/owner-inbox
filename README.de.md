# owner-inbox: Kurzanleitung

Ein Posteingang für alles, was deine Claude-Code-Sitzungen von dir brauchen: Fragen, Entscheidungen, Freigaben, Dinge zum Anschauen, Aufgaben und Testanleitungen. Jeder Eintrag bleibt neben dem Chat stehen, bis du ihn erledigt hast. Deine Antwort geht von selbst an die Sitzung zurück, die gefragt hat.

English: [README.md](README.md).

## Was du siehst

- **Das Fenster „Für dich“** rechts neben dem Chat, in vier Bereichen:
  - **● Offen** (rot): was auf dich wartet, nach Projekt sortiert. Neue Einträge sind mit „● neu“ markiert.
  - **▶ In Arbeit:** woran du gerade sitzt.
  - **⏸ Später:** was du bewusst verschoben hast.
  - **✓ Erledigt:** was du beantwortet hast oder was die Sitzung abgeschlossen hat.
  - **▤ Archiv:** was du aus „Erledigt“ weggeräumt hast.
  Dünne Striche trennen die Bereiche. Jeder Eintrag zeigt links ein schlichtes graues Symbol für die Art (Frage, Entscheidung, Freigabe, Anschauen, Aufgabe, Test), daneben Titel und Uhrzeit, darunter Art, Projekt und welche Sitzung ihn eingetragen hat.
- **Die Zeile über dem Eingabefeld**, zum Beispiel „Für dich: 2 offen, 1 neu“. Rechts am Rand steht farbig, was du verschoben hast, etwa „(⏸ 1 später)“. Ein Klick darauf öffnet das Fenster.
- Optional eine **Benachrichtigung**, wenn etwas Neues kommt.
- Eine **Push-Nachricht aufs Handy**, wenn eine Sitzung mit Remote Control etwas Neues einträgt und du gerade nicht am PC sitzt: eine Zeile mit Projekt, Art und Titel.

## So antwortest du

1. Tippe im Fenster auf einen Eintrag.
2. Lies den Text darunter. Er sollte alles enthalten, was du zum Antworten brauchst.
3. Antworte je nach Art:
   - **Frage oder Entscheidung:** Tippe auf eine der Antworten. Die empfohlene ist hervorgehoben. Oder schreib eine eigene Antwort ins Textfeld und drück Enter.
   - **Freigabe:** „Freigeben“ oder „Ablehnen“, auf Wunsch mit Notiz.
   - **Anschauen:** „Angesehen“ oder „Nicht angesehen“.
   - **Aufgabe:** „Erledigt“ oder „Geht nicht“.
   - **Test:** Markiere jeden Schritt mit „Wie erwartet“ oder „Nicht wie erwartet“. Zu jedem Schritt kannst du eine Notiz schreiben (Enter speichert, „✓ Notiz gespeichert“ zeigt es an). Am Ende „Ergebnis senden“. Fehlt bei einem Schritt noch das Ergebnis, fragt die Inbox einmal nach.
4. Fertig. Der Eintrag wandert zu „Beantwortet“, und die Sitzung bekommt deine Antwort von selbst.

Noch nicht so weit? Unten im Eintrag steht „Stand“: Schreib auf Wunsch eine Notiz an die Sitzung und tippe auf „▶ In Arbeit“ oder „⏸ Später“. Die Sitzung erfährt es mit deiner Notiz, und der Eintrag wandert in den passenden Bereich. „↺ Wieder offen“ holt ihn zurück. Beantworten kannst du ihn aus jedem Bereich.

Vertippt? Unter „Erledigt“ kannst du eine Antwort zurücknehmen und neu geben, solange die Sitzung den Eintrag noch nicht geschlossen hat. Einträge, die dich nicht mehr betreffen, kannst du mit „Ausblenden“ wegräumen.

Aufräumen: Klapp „✓ Erledigt“ auf. „Alle archivieren“ verschiebt alles ins „▤ Archiv“. „Erledigt leeren“ und „Archiv leeren“ nehmen die Einträge ganz aus dem Fenster; vorher fragt die Inbox einmal nach. Die Dateien bleiben auf deinem Rechner, und eine Antwort, die noch unterwegs ist, kommt trotzdem bei der Sitzung an.

## Gut zu wissen

- Alles bleibt auf deinem Rechner, im Ordner `.owner-inbox` in deinem Benutzerordner. Einzige Ausnahme ist die Push-Nachricht aufs Handy mit Projekt, Art und Titel eines neuen Eintrags. Ausschalten geht in den Optionen (`push`).
- Passwörter, Schlüssel und Zugangsdaten gehören nicht hinein. Sieht etwas danach aus, wird es nicht angenommen.
- Antworten gibst nur du: Sitzungen dürfen den Ordner der Inbox nicht selbst beschreiben, damit sich keine Sitzung ihre eigene Freigabe ausstellen kann.
- Nimmst du eine Antwort zurück oder blendest einen offenen Eintrag aus, erfährt die Sitzung das auch.
- **Auffangnetz:** Stellt eine Sitzung dir am Ende ihrer Antwort eine Frage nur im Chat, ohne sie in die Inbox zu legen, übernimmt die Inbox die Frage selbst, markiert mit „aus dem Chat übernommen“. Antwortest du lieber direkt im Chat, schließt deine nächste Nachricht dort den Eintrag wieder. Ausschalten geht in den Optionen (`captureChat`).
- Die Sprache richtet sich nach deinem System. Es gibt elf Sprachen, darunter Deutsch und Englisch. Fest einstellen geht in den Optionen der Erweiterung (`language`, zum Beispiel `de`).
- Auf dem Handy zeigt die Claude-App in einer Sitzung mit Remote Control keine Erweiterungen, also weder das Fenster noch die Zeile. Neue Einträge kommen dort als Push-Nachricht an. Antworten kannst du am PC oder im Chat der Sitzung, die du auf dem Handy offen hast.

## Einbauen

In einer Claude-Code-Sitzung eingeben:

```
/plugin install owner-inbox --marketplace ENFEX-maker/owner-inbox
```

Danach haben alle neu gestarteten Sitzungen die Inbox. Mehr dazu in der [englischen Anleitung](README.md#install).
