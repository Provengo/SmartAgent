# Animated REST verification report

[Open the live presentation](https://provengo.github.io/SmartAgent/)

This Slidev report presents the REST backup benchmark: a naive controller fails after refreshing authentication but reusing an invalid session, while a counterexample-guided controller restarts the transaction and passes bounded formal verification.

Run locally:

```powershell
npm install
npm run dev
```

Build the GitHub Pages site:

```powershell
npm run build
```

GitHub Actions deploys `report/dist` from `main` to GitHub Pages.
