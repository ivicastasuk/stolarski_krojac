# Krojač Iverice

**Optimizacija sečenja ploča radi maksimalnog iskorišćenja materijala**

Web aplikacija za 2D optimizaciju krojenja iverice, MDF-a i sličnih ploča. Bez instalacije, radi direktno u pretraživaču kao jedna HTML stranica.

---

## Sadržaj

- [Opis aplikacije](#opis-aplikacije)
- [Pokretanje](#pokretanje)
- [Interfejs i korišćenje](#interfejs-i-korišćenje)
  - [Merna jedinica](#merna-jedinica)
  - [Dimenzije osnovne ploče](#dimenzije-osnovne-ploče)
  - [Unos komada](#unos-komada)
  - [Uvoz CSV](#uvoz-csv)
  - [Pokretanje optimizacije](#pokretanje-optimizacije)
  - [Rezultati](#rezultati)
  - [Interaktivni kanvas](#interaktivni-kanvas)
- [Opcije i podešavanja](#opcije-i-podešavanja)
- [Algoritam optimizacije](#algoritam-optimizacije)
- [Struktura projekta](#struktura-projekta)
- [Tehnički detalji](#tehnički-detalji)

---

## Opis aplikacije

Krojač Iverice rešava problem 2D pakovne optimizacije (bin packing): zadato je više komada različitih dimenzija koje treba iseći iz standardnih ploča uz minimalan otpad. Aplikacija:

- pronalazi **raspored koji koristi što manje ploča**
- **vizualizuje raspored** svakog isečka po tabli u razmeri
- prikazuje **procenat iskorišćenja**, **korisne ostatke** i **broj rezova** po tabli
- uzima u obzir **debljinu reznog lista** (kerf) kako bi raspored bio tačan
- pamti podatke između sesija (LocalStorage)

---

## Pokretanje

Nije potrebna instalacija niti server. Dovoljno je otvoriti `index.html` u bilo kom modernom pretraživaču:

```
index.html   →  dvostruki klik ili "Open with browser"
```

> Preporučeni pretraživači: Chrome, Edge, Firefox (bilo koja verzija iz poslednje 3 godine).

---

## Interfejs i korišćenje

### Merna jedinica

Padajući meni **Merna jedinica** (mm / cm / m) kontroliše prikaz i unos svih dimenzija globalno. Prebacivanje automatski konvertuje sve prikazane vrednosti.

Interno, aplikacija uvek čuva dimenzije u **milimetrima**.

---

### Dimenzije osnovne ploče

| Polje | Opis |
|---|---|
| **Širina (X)** | Širina standardne ploče (npr. 2800 mm) |
| **Visina (Y)** | Visina standardne ploče (npr. 2070 mm) |
| **Debljina reza (kerf)** | Debljina reznog lista testere u mm (tipično 3 mm). Uzima se u obzir pri svakom rezu. |
| **Min. traka otpada** | Minimalna širina preostalog komada da bi se smatrao korisnim ostatkom (ispod ovoga se tretira kao prah; preporučeno 40 mm) |
| **Dozvoli rotaciju (90°)** | Globalna dozvola rotacije — komadi se mogu okretati za 90° ako bolje stanu |
| **Jednobojan dezen** | Ploča bez smera šare (MDF, jednobojna iverica). Svi komadi se rotiraju slobodno bez obzira na individualna podešavanja po komadu. |
| **Smer šare** | Vidljivo samo kada je dezen **uključen** (ima smera). `Horizontalno ↔` = šare teku levo-desno; `Vertikalno ↕` = šare teku gore-dole. Utiče na vizualizaciju zrna na kanvasu. |
| **Strategija** | `Brza` = 3 heuristike, brz rezultat; `Napredna` = 48 determinističkih + nasumičnih kombinacija, bolji rezultat |
| **Iteracije** | Samo za naprednu strategiju: broj iteracija pretrage (5–500, preporučeno 60–120) |
| **Optimizuj broj rezova** | Ako je uključeno, algoritam favorizuje rasporede koji zahtevaju manji ukupan broj prolaza testerom |

Kanvas se **odmah ažurira** čim se promene dimenzije ploče, dezen ili smer šare — bez potrebe za ponovnim optimizovanjem.

---

### Unos komada

Svaki komad se definiše sa:

| Polje | Opis |
|---|---|
| **Širina** | Širina komada u trenutnoj mernoj jedinici |
| **Visina** | Visina komada |
| **Količina** | Broj komada tih dimenzija (ceo pozitivan broj) |
| **Rot** | Checkbox — da li se ovaj konkretni komad sme rotirati za 90° |

Kliknuti **Dodaj** ili pritisnuti `Enter`. Komad se validira:
- dimenzije moraju biti pozitivne
- komad mora da stane na ploču (u normalnoj ili rotiranoj orijentaciji)

U listi komada svaka vrsta dobija svoju boju, a pored naziva dimenzija prikazuje se i ukupna količina. Komadi se mogu **uređivati inline** (klik na vrednost) i **brisati** (ikona ×).

---

### Uvoz CSV

Kliknuti **↑ Uvezi CSV** i odabrati `.csv` ili `.txt` fajl.

**Format** (jedan tip komada po redu):

```
sirina,visina,kolicina,rotacija
600,400,3,rot
1200,800,1,fix
300,300,6,rot
```

- separator: `,` ili `;` ili tab
- `rot` = rotacija dozvoljena; `fix` = zabranjeno (polje je opciono; default je `rot`)
- linije koje počinju sa `#` se ignorišu (komentari)
- prazne linije se preskaču

Nakon uvoza prikazuje se info sa brojem uspešno uvezenih redova i eventualnim greškama.

---

### Pokretanje optimizacije

Kliknuti **Optimizuj**. Tokom optimizacije prikazuje se traka napretka sa procentima.

Optimizacija radi **u browserovom glavnom nizu** ali daje kontrolu pretraživaču između chunk-ova (async yield) — stranica ostaje odazivna.

Dugmad dostupna u toku optimizacije su blokirana da bi se sprečila dupla submisija.

---

### Rezultati

Po završetku, desna strana prikazuje svaku ploču:

- **Vizuelni raspored** — svaki komad je obojen svojom bojom, prikazane su dimenzije unutar komada
- **Iskorišćenje** — procenat popunjene površine i površina u m²
- **Korisni ostaci** — slobodne površine ≥ 150×150 mm koje mogu biti ponovo upotrebljene, sortirane po veličini
- **Broj rezova** — ukupan broj rezova potrebnih za dobijanje svih komada sa te table, razbijen na:
  - **horizontalni rezovi** — puni prolazi testerom po širini ploče (rip rezovi)
  - **vertikalni rezovi** — poprečni rezovi

Ispod kanvase prikazuju se globalne statistike:
- ukupan broj upotrebljenih ploča
- procenat iskorišćenja
- lista neisečenih komada (ako postoje — komadi preveliki za ploču)

**Legenda** navodi sve dimenzije sa bojom i brojem komada te dimenzije. Direktno u legendi nalaze se live-kontrole:
- **Prikaži dezen** — uključuje/isključuje crtanje zrna drveta na kanvasu
- **Prikaži linije rezova** — uključuje/isključuje plave linije horizontalnih i narandžaste linije vertikalnih rezova

Ove kontrole menjaju vizualizaciju **odmah, bez ponovnog optimizovanja**.

---

### Interaktivni kanvas

Svaka tabla je interaktivni kanvas:

| Akcija | Efekat |
|---|---|
| **Scroll (točkić miša)** | Zum — uvećanje/umanjenje prikaza |
| **Klik + pomeranje** | Pomeranje (pan) po uveličanoj tabli |
| **Dvostruki klik** | Reset zum i pozicije |
| **Hover (prelaskom miša)** | Tooltip sa detaljima komada: dimenzije, status rotacije, pozicija na tabli |

---

## Opcije i podešavanja

### Izvoz i čuvanje

| Dugme | Opis |
|---|---|
| **Izvoz JSON** | Preuzima trenutne parametre i listu komada kao `.json` fajl |
| **Štampaj** | Otvara browser dijalog za štampu (optimizovan CSS za papir) |
| **Reset** | Briše sve komade i vraća kanvas na prazan preview ploče. Parametri ploče ostaju. |

### Automatsko pamćenje

Aplikacija **automatski čuva** sve parametre i listu komada u `localStorage` pri svakoj promeni. Podaci se automatski učitavaju pri sledećem otvaranju aplikacije.

Čuva se:
- dimenzije ploče, kerf, minWaste
- strategija, iteracije, optimizeCuts
- uniformTexture, grainAngle
- kompletan spisak komada sa dimenzijama, količinama i statusom rotacije

---

## Algoritam optimizacije

### Maximal Rectangles (MAXRECTS)

Srce aplikacije je MAXRECTS algoritam za 2D bin packing. Za razliku od jednostavnijeg guillotine pristupa:

- prati **sve maksimalne slobodne pravougaonike** na ploči
- pri svakom postavljanju komada, slobodne pravougaonike deli na do 4 sub-pravougaonika oko blokiranog prostora
- redundantne (sadržane) pravougaonike automatski uklanja

Ovo omogućava popunjavanje **ugaonih i neregularnih slobodnih prostora** koje guillotine algoritam propušta.

### Heuristike postavljanja

Pri svakom koraku, algoritam bira **koji komad u koji slobodni pravougaonik** da postavi koristeći jednu od 6 heuristika:

| Heuristika | Opis |
|---|---|
| **BSSF** (Best Short Side Fit) | Minimizuje kraći ostatak stranice. Čuva prostor "kvadratnim" za buduće komade. Generalno najbolja heuristika za mešovite skupove. |
| **BLSF** (Best Long Side Fit) | Minimizuje duži ostatak. Agresivno popunjava tesne prostore. |
| **BAF** (Best Area Fit) | Minimizuje ostatak površine. Maksimizuje trenutnu efikasnost. |
| **BSSF+BAF hibrid** | Kombinuje BSSF sa normalizovanim BAF kao tiebreaker-om. |
| **Bottom-Left Corner** | Preferuje slobodne pravougaonike bliže ishodištu. Gravitira komade ka jednom uglu. |
| **WBAF** (Waste-Adjusted Fit) | BAF sa penalom za stvaranje tankih neupotrebljivih traka (≤ 80 mm). |

### Strategije pretrage

**Brza strategija:**
- pokreće 3 osnovne heuristike (BSSF, BLSF, BAF) sa sortiranjem po površini
- bira nabolji od 3 rezultata
- primenjuje konsolidaciju

**Napredna strategija:**
- **Faza 1 — deterministička pretraga:** 8 različitih sortiranja × 6 heuristika = **48 determinističkih kombinacija**
- **Faza 2 — nasumična pretraga:** šumovito sortiranje (noisy sort) — aproksimativno sortiranje po površini sa slučajnim perturbacijama različitog intenziteta (čime se dobijaju različita rešenja bez gubitka smisaonosti)

### 8 strategija sortiranja

1. Najveća površina prva
2. Najveća dimenzija prva  
3. Najveći obim prva
4. Najduža kraća stranica prva
5. Najmanja površina prva (za popunjavanje praznina)
6. Nasumično
7. Najkvadrativniji komad prva
8. Najizduženiji komad prva

### Konsolidacija ploča

Nakon pronalaska boljeg rešenja, algoritam pokušava da **eliminiše spare ploče** iterativnim postupkom:

1. Sortira ploče po iskorišćenosti (od najmanje ispunjene)
2. Za najmanje ispunjenu ploču, pokušava da rasporedi njene komade na preostale ploče
3. Koristi svih 6 heuristika za svaki pokušaj eliminacije
4. Ponavlja dok god postoji poboljšanje

Ovo može kaskadirati: eliminacijom jedne ploče može postati moguće eliminisati i sledeću.

### Objektivna funkcija

Prioriteti (od najvažnijeg):

1. **Što manje neisečenih komada** (svaki komad mora biti isečen)
2. **Što manje ploča** (materijalni trošak)
3. **Veće iskorišćenje** (manji otpad unutar kupljenih ploča)
4. **Bolje iskorišćena poslednja ploča** (koncentracija otpada, ne rasipanje)
5. **Manji broj rezova** *(samo kada je "Optimizuj broj rezova" uključen)*

### Optimizacija rezova

Kada je uključena opcija "Optimizuj broj rezova", algoritam:
- koristi **strip-sort** sa malim slučajnim perturbacijama: grupiše komade iste maksimalne visine u "trake" → MAXRECTS prirodno formira horizontalne strip-rasporede
- kao 5. tiebreaker favorizuje rasporede sa manjim brojem horizontalnih prolaza testerom

---

## Struktura projekta

```
index.html              — Jedina HTML stranica, sav UI markup
assets/
  css/
    style.css           — Kompletni stilovi (layout, komponente, print, responsive)
  js/
    ui.js               — Glavni kontroler: state, eventi, validacija, persistencija
    packing.js          — MAXRECTS algoritam, heuristike, konsolidacija
    render.js           — Crtanje kanvasa, grain tekstura, interaktivnost, statistike
    storage.js          — LocalStorage wrapper (save/load/clear)
    units.js            — Konverzija mjernih jedinica (mm/cm/m)
    optimizer.js        — (nekorišćeno, legacy)
  img/                  — Resursi za slike (trenutno prazno)
```

---

## Tehnički detalji

- **Vanilla JS ES moduli** — bez build alata, bez zavisnosti, bez Node.js
- **Single-page aplikacija** — sve u jednom `index.html`
- **Interny format podataka** — svi podaci se čuvaju i obrađuju u **mm** bez obzira na odabranu mjernu jedinicu
- **Kanvas rezolucija** — fiksna 700×480 px, CSS skalira via `max-width: 100%`
- **Grain tekstura** — generisana pseudo-nasumičnim LCG generatorom seed-ovanim pozicijom ploče, linije polaze od ugla ploče (teku kontinualno kroz sve komade, kao pravo drvo)
- **Boje komada** — deterministička hash funkcija sa golden-angle rotacijom (137.5°) — isti komad uvek ista boja, maksimalna perceptivna razlika između tipova
- **LocalStorage ključ:** `krojac_v1`

### Browserska podrška

| Pretraživač | Minimalna verzija |
|---|---|
| Chrome / Edge | 80+ |
| Firefox | 75+ |
| Safari | 14+ |

---

*© 2025 Krojač iverice by ISWorkshop. Sva prava zadržana.*
