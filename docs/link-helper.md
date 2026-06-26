# Getting EDH Play tokens for the bot

EDH Play stores its login in the browser's `localStorage` under `access_token`
(a JWT) and `refresh_token` (an opaque string). These two helpers read those for
you. Run them **on edhplay.com while logged in**.

> ⚠️ These tokens grant full access to the EDH Play account. They stay on your
> machine — the helpers copy them to your clipboard / print them in your own
> console. Only paste them into the bot's `/link` box or the bot's `.env`. Never
> share them in chat.

## Bookmarklet — for `/link` (per-user)

Create a new bookmark named e.g. "EDH Play → bot" and set its URL to the line
below (it's a `javascript:` bookmarklet, all one line):

```
javascript:(function(){try{var a=localStorage.getItem('access_token'),r=localStorage.getItem('refresh_token');if(!a||!r){alert('EDH Play tokens not found - log in on edhplay.com first.');return;}var b=JSON.stringify({access_token:a,refresh_token:r});var ok=function(){alert('EDH Play tokens copied. Paste into the bot /link box.');};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(b).then(ok,function(){window.prompt('Copy this, paste into /link:',b);});}else{window.prompt('Copy this, paste into /link:',b);}}catch(e){alert('Error: '+e.message);}})();
```

Use it: open edhplay.com (logged in) → click the bookmark → run `/link` in
Discord → paste into the **first** box (leave the refresh box blank).

## Console snippet — for the shared service account (`.env`)

Paste into DevTools console (F12 → Console) on edhplay.com while logged into the
account you want the bot to post rooms as. It copies the `/link` blob to your
clipboard **and** prints the two `.env` lines:

```js
(()=>{const a=localStorage.getItem('access_token'),r=localStorage.getItem('refresh_token');if(!a||!r){console.error('Not logged in? access_token/refresh_token missing.');return;}copy(JSON.stringify({access_token:a,refresh_token:r}));console.log('%c/link blob copied to clipboard.','color:green;font-weight:bold');console.log('For .env (shared service account):\n\nEDHPLAY_SERVICE_ACCESS_TOKEN='+a+'\nEDHPLAY_SERVICE_REFRESH_TOKEN='+r);})()
```

Copy the two `EDHPLAY_SERVICE_*` lines into the bot's `.env`, then restart the
bot. From then on every pod launches a real room under that account and nobody
else has to link.
