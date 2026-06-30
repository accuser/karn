---
title: The Bynk Book
description: The Book has not migrated yet — this is the slice-1 shell.
---

The Book migrates here in a later slice. For now this empty shell proves the
framework is live and that **`bynk` highlighting** works — rendered through the
very same TextMate grammar the VS Code extension uses (`source.bynk`):

```bynk
commons hello.text

--- Who we are greeting — non-empty, at most 40 characters. ---
type Subject = String where NonEmpty and MaxLength(40)

--- The canonical greeting for a subject. ---
fn greeting(subject: Subject) -> String {
  "Hello, \(subject)!"
}
```

Until then, open the [playground](https://playground.bynk-lang.org) to run Bynk
in the browser.
