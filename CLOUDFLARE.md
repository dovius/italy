# Diegimas į „Cloudflare Free“

Projektas paruoštas **„Cloudflare Workers“ su statiniais failais**. Vienas diegimas pateikia svetainę, PWA ir API tuo pačiu HTTPS adresu. Mokamo serverio, atskiro domeno ir lankytojų registracijos nereikia.

## Pirmasis diegimas

Reikia Node.js 22.12+ ir „Cloudflare“ paskyros su nemokamu „Workers“ planu. Projekto aplanke:

```sh
npm ci
npm run cf:prepare
npx wrangler login
npm run cf:deploy
```

`cf:prepare` perkelia **tik** `OPENAI_API_KEY` ir pasirenkamą `TRIP_ACCESS_TOKEN` iš esamo `.env` į privatų `.dev.vars`. Esamų failų neperrašo ir raktų nerodo. Jei rakto dar neturite projekte, nukopijuokite `.dev.vars.example` į `.dev.vars` ir įrašykite `OPENAI_API_KEY` ten.

`wrangler login` atvers naršyklę prisijungimui prie jūsų „Cloudflare“ paskyros. Jei ji nauja, vedlys gali paprašyti pasirinkti nemokamą `workers.dev` subdomeną. `cf:deploy` surinks projektą, įkels paslaptis kaip serverio **Secrets** ir sukurs SQLite sesijų saugyklą pagal `wrangler.jsonc`. Atskiros duomenų bazės kurti nereikia.

Pabaigoje terminalas parodys panašų adresą:

```text
https://keliones-vertejas.jusu-subdomenas.workers.dev
```

Atverkite **terminalo parodytą** adresą telefone. Šiam diegimui nereikia nustatyti `APP_ORIGIN`, `PORT`, `HOST` ar `TRUST_PROXY`: API automatiškai tikrina dabartinį svetainės adresą. HTTPS įjungiamas automatiškai.

Šio projekto `wrangler.jsonc` taip pat prijungia **`italiano.vild.lt`** prie `keliones-vertejas` Worker. Diegiant iš kitos paskyros, pakeiskite arba pašalinkite `routes` įrašą.

`.dev.vars` ir `.env` nepatenka į Git, Docker ar viešus svetainės failus. Raktas perskaitomas tik serveryje. Nenaudokite `VITE_` prefikso paslaptims.

## Atnaujinimas

Po kodo pakeitimų tame pačiame aplanke:

```sh
npm run cf:deploy
```

Jei pakeitėte raktą `.env`, atnaujinkite jį ir `.dev.vars`: paruošimo komanda sąmoningai neperrašo esamų paslapčių. Diegimas naudoja `.dev.vars` reikšmes.

## `italiano.vild.lt` grąžina `405 Method Not Allowed`

Patikrinus paskyrą nustatyta, kad šis domenas buvo prijungtas prie kito Worker – `italy`, kuriame nėra vertimo API susiejimų. Veikiantis serveris įdiegtas kaip `keliones-vertejas`. Vien svetainės failų neužtenka `POST /api/live/session` užklausai aptarnauti.

Konfigūracijoje domenas jau nurodytas teisingam Worker. Paleiskite `npm run cf:deploy`. Jei Wrangler paklaus **“Update them to point to this script instead?”** dėl `italiano.vild.lt`, patvirtinkite `y`: taip domenas perkeliamas iš `italy` į `keliones-vertejas`. Tai yra Wrangler patvirtinimas keičiant kitam Worker priskirtą domeną. [„Cloudflare Custom Domains“](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Po diegimo `https://italiano.vild.lt/api/health` turi grąžinti JSON `{"ok":true,"configured":true}`. `configured` patvirtina rakto buvimą, bet ne jo galiojimą ar kreditų likutį. Jei vietoje JSON matoma svetainė arba `POST` vis dar gauna 405, domenas dar nepasiekia teisingo Worker. Alternatyvus serverio adresas: `https://keliones-vertejas.dovius-vili.workers.dev`.

## Pasirinktinai: nuoroda tik kelionės grupei

Į `.dev.vars` pridėkite ilgą atsitiktinį `TRIP_ACCESS_TOKEN`. Reikšmę galite sugeneruoti komanda `openssl rand -hex 24`. Pakartokite `npm run cf:deploy` ir bendrakeleiviams perduokite:

```text
https://JUSU-ADRESAS.workers.dev/join/JUSU_TOKEN
```

Nuorodą užtenka atverti vieną kartą toje naršyklėje: leidimas galioja 14 dienų, prisijungimo ekrano nėra. Be šio nustatymo API gali naudotis visi, žinantys svetainės adresą. Nuorodos turėtojas naudoja jūsų „OpenAI“ kreditus. Diegimo komandai pateikiamos paslaptys atnaujinamos, o nepateiktos senos paslaptys išlieka; norėdami vėliau atsisakyti ribojimo, vykdykite `npx wrangler secret delete TRIP_ACCESS_TOKEN`.

## Kas įeina į nemokamą planą

- Statinių svetainės failų užklausos nemokamos ir neribojamos. [„Static Assets“ kainodara](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
- „Workers Free“ suteikia iki 100 000 dinaminių užklausų per dieną; kvota bendra paskyrai. [„Workers“ ribos](https://developers.cloudflare.com/workers/platform/limits/).
- Naudojami **SQLite Durable Objects**, prieinami nemokamame plane. Jiems taikomos atskiros užklausų, vykdymo ir saugyklos kvotos. Pasiekus Free ribą užklausos gali nebeveikti iki kvotos atnaujinimo. [„Durable Objects“ kainodara](https://developers.cloudflare.com/durable-objects/platform/pricing/).

**„Cloudflare Free“ neapmoka „OpenAI“ API.** Vertimas balsu, nuotraukos, klausimai ir garso sintezė naudoja jūsų „OpenAI“ projekto kreditus. Mažai privačiai kelionės grupei ši architektūra pritaikyta nemokamoms „Cloudflare“ kvotoms, bet bendro naudojimo kiekis priklauso nuo pokalbių ir užklausų trukmės.

## Kaip veikia serveris

Nuotraukoms ir klausimams naudojamas `gpt-5.6-sol` su `reasoning.effort: "low"` ir `service_tier: "fast"`. Tai nustatyta bendroje abiejų serverio variantų užklausoje; atskirai įjungti „Fast mode“ „OpenAI“ paskyroje nereikia. [„Fast mode“ dokumentacija](https://developers.openai.com/api/docs/guides/fast-mode).

```text
Telefonas ── HTTPS ── „Workers Static Assets“: React + PWA
         └─ /api/* ── Worker ── naršyklės TripSession ── „OpenAI“
         └─ WebRTC ────────────────────────────────── GPT-Live-1
```

Statiniams failams Worker nepaleidžiamas. `/api/*` ir `/join/*` visada pasiekia serverį. Kiekvienai anoniminei naršyklei priskiriamas atskiras `TripSession` objektas: išlieka užklausų limitai, balso sesijos savininkas ir pakartotinių klausimų atsakymai, net jei „Cloudflare“ perkrauna procesą. Didesnės nuotraukų užklausos apdorojamos šiame objekte, ne pradiniame Worker su trumpu Free CPU limitu. Balso srautas keliauja tiesiai tarp telefono ir „OpenAI“.

Visas kelionės kontekstas ir paskutinė nuotrauka saugomi telefone. „Cloudflare“ trumpai laiko atsakymo kopiją (apie 10 minučių), užklausos maišą, limitų skaitiklį ir aktyvios balso sesijos ID. Nuotraukos, garso įrašai, užklausų tekstai ir pilna istorija saugykloje neįrašomi. „Durable Object“ žadintuvai išvalo pasibaigusius įrašus ir po 30 minučių uždaro likusią balso sesiją; nesėkmingą uždarymą pakartoja. AI tiekėjo duomenų saugojimo taisyklės taikomos atskirai.

## Patikrinimas kompiuteryje

```sh
npm run cf:check
npm run test:cloudflare
npm run cf:dev
```

`cf:check` tik surenka ir patikrina diegimo paketą (`--dry-run`), nieko nepublikuoja. `test:cloudflare` paleidžia API testus tikrame vietiniame `workerd` su imituojama „OpenAI“ paslauga, todėl kreditų nenaudoja. `cf:dev` paleidžia programą adresu **http://localhost:8787**; rankiniai AI veiksmai su jūsų raktu naudoja kreditus.

Naršyklės scenarijai su vietiniu „Cloudflare“ serveriu ir imituojamais AI atsakymais:

```sh
npx playwright install chromium webkit
npm run test:e2e:cloudflare
```

Po diegimo telefone išbandykite trumpą balso pokalbį, meniu nuotrauką ir klausimą. Mikrofonas bei kamera turi gauti naršyklės leidimą. PWA įdiegsite per telefono naršyklės meniu „Pridėti prie pradžios ekrano“. Naujiems vertimams reikia interneto.

## Jei norite diegti per „Cloudflare“ Git integraciją

Pasirinkite **Workers** projektą. Vien `dist` aplanko įkėlimas kaip statinės „Pages“ svetainės nepaleis API.

| Laukas | Reikšmė |
| --- | --- |
| Root directory | Projekto šaknis |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npx wrangler deploy` |
| Worker name | `keliones-vertejas` |

Worker nustatymuose pridėkite runtime **Secret** `OPENAI_API_KEY` ir, jei reikia, `TRIP_ACCESS_TOKEN`. `.dev.vars` į Git nekeliamas, todėl Git diegimas jo nenaudoja. Šiam projektui `wrangler.jsonc` jau nurodo `dist` ir API įėjimo failą.

## Po kelionės

`npm run cf:delete` pašalina Worker iš paskyros; komanda paprašys patvirtinimo. Taip sustabdysite naujas užklausas. Jei „OpenAI“ raktas buvo skirtas tik šiai kelionei, jį galite panaikinti „OpenAI“ projekto nustatymuose.
