# owner-inbox: Kurzanleitung

Ein Posteingang für alles, was deine Claude-Code-Sitzungen von dir brauchen: Fragen, Entscheidungen, Freigaben, Dinge zum Anschauen, Aufgaben und Testanleitungen. Jeder Eintrag bleibt neben dem Chat stehen, bis du ihn erledigt hast. Deine Antwort geht von selbst an die Sitzung zurück, die gefragt hat.

English: [README.md](README.md).

## Was du siehst

- **Das Fenster „Für dich“** rechts neben dem Chat. Darin steht alles, was offen ist, nach Projekt sortiert. Bei jedem Eintrag steht, welche Sitzung ihn eingetragen hat und wann. Neue Einträge haben einen vollen Punkt (●).
- **Die Zeile über dem Eingabefeld**, zum Beispiel „Für dich: 2 offen, 1 neu“. Ein Klick darauf öffnet das Fenster.
- Optional eine **Benachrichtigung**, wenn etwas Neues kommt.

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

Vertippt? Unter „Beantwortet“ kannst du eine Antwort zurücknehmen und neu geben, solange die Sitzung den Eintrag noch nicht geschlossen hat. Einträge, die dich nicht mehr betreffen, kannst du mit „Ausblenden“ wegräumen.

## Gut zu wissen

- Alles bleibt auf deinem Rechner, im Ordner `.owner-inbox` in deinem Benutzerordner. Nichts wird ins Internet geschickt.
- Passwörter, Schlüssel und Zugangsdaten gehören nicht hinein. Sieht etwas danach aus, wird es nicht angenommen.
- Antworten gibst nur du: Sitzungen dürfen den Ordner der Inbox nicht selbst beschreiben, damit sich keine Sitzung ihre eigene Freigabe ausstellen kann.
- Nimmst du eine Antwort zurück oder blendest einen offenen Eintrag aus, erfährt die Sitzung das auch.
- Die Sprache richtet sich nach deinem System. Fest einstellen geht in den Optionen der Erweiterung (`language`: `de` oder `en`).
- Auf dem Handy (Claude-App mit Remote Control) erscheint das Fenster im Bereich „Mods“. Dort gibt es nur Knöpfe, noch keine Textfelder.

## Einbauen

In einer Claude-Code-Sitzung eingeben:

```
/plugin install owner-inbox --marketplace <owner>/<repo>
```

Danach haben alle neu gestarteten Sitzungen die Inbox. Mehr dazu in der [englischen Anleitung](README.md#install).
