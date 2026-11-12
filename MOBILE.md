# Nur Grab Mobile

Même moteur que l’app Electron (C411 → affiche → confirm → Transmission / qBit sur Ultra).

## PC éteint ?

| Où tourne `node server.js` | Tel OK ? | PC éteint ? |
|---|---|---|
| Sur ton PC | Oui (Wi‑Fi / Tailscale) | **Non** — le serveur meurt avec le PC |
| Sur Ultra (seedbox 24/7) | Oui (URL publique / VPN) | **Oui** |

Les DL partent toujours sur Ultra. Le PC n’est qu’un écran. Pour le mode « PC off », il faut héberger ce serveur **sur Ultra** (ou un VPS toujours allumé).

## Local (PC allumé)

```bat
Lancer Nur Grab Mobile.bat
```

Ouvre le lien `http://IP:?token=…` affiché dans la console (Safari/Chrome → Partager → Sur l’écran d’accueil).

## Ultra (recommandé, PC off) — déjà en place

URL tel (PC éteint OK) :

`https://ryan.joker.usbx.me/grab/?token=<mobileToken>`

- Code : `~/apps/nur_grab`
- Port Ultra assigné : `mobilePort` dans `config.json` (ex. 39664)
- Nginx : `~/.apps/nginx/proxy.d/grab.conf`
- Auto-start : `@reboot ~/apps/nur_grab/start-mobile.sh`
- Relance : `node scripts/ultra-start.js` (depuis le PC)
- Redeploy : `node scripts/deploy-ultra-finish.js`

## Sécurité

- Toutes les routes `/api/*` exigent le token (`?token=` une fois, puis localStorage).
- Ne partage pas le lien token en public.
