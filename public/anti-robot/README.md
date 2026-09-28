# HumanLayer Anti-Robot (Packaged)

This folder contains a reusable anti-robot challenge you can embed on any site.

## Files

- `humanlayer-antibot.js`: standalone browser script (no build step)

## 1) Add a verification page

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <script src="/anti-robot/humanlayer-antibot.js"></script>
</head>
<body>
  <script>
    HLAntiRobot.mount(document.body, {
      lang: 'en',                       // 'fr' or 'en'
      redirectUrl: '/admin/',           // where user goes after success
      storageKey: 'hl_verify',          // optional
      storageTsKey: 'hl_verify_ts',     // optional
      texts: {
        successInstruction: 'Redirecting to admin…'
      }
    });
  </script>
</body>
</html>
```

## 2) Protect a page (gate)

On your protected page:

```html
<script src="/anti-robot/humanlayer-antibot.js"></script>
<script>
  HLAntiRobot.requireVerified({
    redirectUrl: '/admin/verify.html',
    maxAgeMs: 10 * 60 * 1000,          // optional
    storageKey: 'hl_verify',           // optional
    storageTsKey: 'hl_verify_ts'       // optional
  });
</script>
```

## API

- `HLAntiRobot.mount(target, options)`
- `HLAntiRobot.requireVerified(options)` -> `boolean`
- `HLAntiRobot.isVerified(options)` -> `boolean`
- `HLAntiRobot.clearVerification(options)`

