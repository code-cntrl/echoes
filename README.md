# Echoes 💛

*Echoes was called Family Feedback until November 2026. Family data, backups and linked phones carry
over; a phone that added it to the Home Screen before keeps the old label until it's added again.*

A small app for kind, constructive, optionally anonymous feedback between family
members. It is built for **iPhones and Chromebooks**, installs to the home screen,
and keeps everything at home: no accounts and no cloud service. (If you turn on
[notifications](#notifications), the hub sends a content-free "something new" ping through
Apple's or Google's push service; messages still never leave home.)

## Pick how your family will use it

| | 🏠 **Home hub** (recommended) | 📱 **Phone as home base** (experimental) | 🖥️ **One shared device** |
|---|---|---|---|
| Best for | Everyday use: everyone has a phone and you have an always-on computer | No computer: occasional, in-person batch exchange | One family iPad or Chromebook |
| Where messages live | A JSON file on the home computer | IndexedDB on the home base phone | IndexedDB in that one browser |
| Messages arrive | Straight away, on the home Wi-Fi | Only when a phone is synced with the home base, in person | Straight away |
| Notifications | Yes, with the hub on https ([how](#notifications)) | No | No |
| Needs | Node.js 20+ | The app on an https address (GitHub Pages, or `npm run serve:https` for testing) | The app on any static web host |
| Adding people | Invite link + QR code | **Link phone**: scan QR codes both ways | Add them, then pass the device |
| Backups | Copy `data/family.json` | Family → Download backup | Family → Download backup |

The last two are the same setup: a device that keeps the family is the **home base**.
Others can use it in turn, link their own phone to it, or both.

## Quick start (a phone as home base)

> **Experimental.** This mode has been tested between browsers on one computer, not yet
> between real iPhones; see [Testing on real iPhones](#testing-on-real-iphones). It is a
> **manual, in-person batch sync**, not a live hub: for everyday feedback, the home hub works better.

Use this when there is no computer to run the hub. You need the app on an **https://**
address, because phones only use the camera and install web apps from secure pages:
it's live at **https://code-cntrl.github.io/echoes/**, or publish your own copy with GitHub Pages
(below) or any static host.

1. **Home base:** a parent opens the app on their phone, adds it to the Home Screen,
   opens it from there and sets up the family. Add everyone on **Family**.
2. **Link a phone:** on the home base, tap **Link phone** next to the person. It starts with a
   **Get Echoes** code: they point their iPhone's Camera at it and tap the link. Safari explains
   to add Echoes to the Home Screen first (an iPhone keeps a Home Screen app's data apart from
   Safari's, so the link must be made there); they open it from the Home Screen and tap **Link
   this phone**. **Send the link** shares the same address by AirDrop or Messages instead. If
   Echoes is already on their phone, skip it with **Next**. Then tap **Next** on the home base:
   their phone scans its sync code and shows a reply code, the home base scans that, and the
   phone is linked to that person.
3. **Sync when together:** on the linked phone, tap the sync status at the top; on the
   home base, tap **Sync a linked phone** (Family, or the sign-in screen). Scan both
   ways again. Queued messages go out and the inbox updates. Until the home base taps
   **Done** (it stays on the Sync screen meanwhile), the linked phone's requests go
   straight to it; there is no push, and each phone needs its own sync.

While apart, a linked phone shows its last copy of its own inbox and sent list. New
messages, reactions, replies, read marks and removals are checked the same way the home
base checks them, then queued (marked **Waiting** in Sent). Settings, profile and family
changes need a live connection. If the home base refuses a queued message (say,
the person it was for was removed), it stays in **Sent** with the reason and a
**Discard** button.

Things to know:

- The phones talk **directly over the Wi-Fi** (WebRTC, encrypted). No server, STUN or
  relay is used, so both must be on the same network, and guest networks that keep
  devices apart won't work. Nothing else leaves the home. If a phone finds no Wi-Fi
  address it says so before showing a code; **Connection details** on the Sync screen
  show what each phone offered and how far the connection got.
- On iPhone, Safari and a Home Screen app keep **separate data**. Always open the app
  from the Home Screen icon, on both phones. This is why the QR scanner is in the app
  rather than the Camera app.
- No camera? Each sync screen has **Copy this code** and **Paste the code**. Safari may
  only offer a Wi-Fi address once the camera is allowed, so if the camera is refused,
  pasting may not be enough.
- Changes are sent with a random id, so one whose reply was lost isn't applied twice
  when it is sent again.
- Only one tab or window per device can use the family at a time; another one offers
  **Use it here**.
- A linked phone holds only **its own person's** messages, never the whole family's.
  Its key is a random 256-bit secret; the home base stores only a hash of it.
- **Unlink** a lost phone from the home base (Family → **Unlink** next to the person); removing a
  person unlinks their phones too. **Unlink this phone** on the phone itself removes
  its copy. A restored backup doesn't include linked phones, so link them again; a phone
  linked again to the same person keeps whatever was waiting to send.
- Keep the home base safe and back it up: it holds everyone's messages.
- Linked phones sync **only with the home base**, never with each other: a message from
  Sam to Ava reaches Ava after Sam's phone and then Ava's phone have each synced with it.

### Syncing away from home

No shared Wi-Fi (on holiday, at the grandparents')? Let the phones make their own network:

1. On the **home base** phone, turn on **Personal Hotspot** (on iPhone: Settings → Personal
   Hotspot → **Allow Others to Join**).
2. On the **other phone**, join that hotspot in Settings → Wi-Fi.
3. Sync as usual: scan the codes both ways.

The phones still talk to each other directly over that little network; nothing goes over the
internet, so the hotspot's mobile data isn't used for the sync itself. Both phones need the app
already on their Home Screen, opened at least once from it, so it starts without a connection.
The Sync screen shows this tip while the phones are pairing and when they can't connect.
**This hasn't been tested on real iPhones yet**: if the phones can't find each other, open
**Connection details** on the Sync screen and check that each one offered a Wi-Fi IP or a
private name.

### Hosting on GitHub Pages

Echoes is live at **https://code-cntrl.github.io/echoes/**: open it in Safari on an iPhone and tap
**Share → Add to Home Screen**. No computer or certificate is needed; it runs as a phone home base.

`.github/workflows/pages.yml` runs the tests and publishes `public/` whenever `main` is pushed, or
when started by hand (**Actions → Deploy to GitHub Pages → Run workflow**). For your own copy, open
**Settings → Pages** in the repository and set **Source** to **GitHub Actions**. The app is then at `https://<you>.github.io/<repo>/`. Only the
app's code is published; each family's messages stay on their phones. Free GitHub
Pages needs a public repository.

## Testing on real iPhones

`npm run serve:https` serves the app over https from this computer, in this-device
mode (as GitHub Pages would), so you can test the phone home base without publishing
anything. It needs `openssl` (Git for Windows includes it). The first run makes a test
certificate authority in `data/https/`, which can only vouch for home-network addresses.

1. Put this computer and the iPhones on the **same Wi-Fi**.
2. `npm run serve:https`. It prints two addresses, for example
   `http://192.168.1.20:8080/` (setup) and `https://192.168.1.20:8443/` (the app).
3. On each iPhone, open the **setup** address in Safari and follow it: download the
   certificate, check its **SHA-256** fingerprint (Settings → Profile Downloaded → More
   Details) against the one this computer printed, install it in **Settings**, and turn it on
   in **General → About → Certificate Trust Settings**. Only do this on your own Wi-Fi: the
   setup page is plain http, and the fingerprint is how you know the certificate is yours.
4. Open the **app** address, **Add to Home Screen**, and open it from there.

Remove the certificate afterwards in **Settings → General → VPN & Device Management**.

Try each row with two iPhones; open **Connection details** on the Sync screen and note
what it says whenever something fails.

| # | Try | Expect |
|---|---|---|
| 1 | Home base: set up the family from the Home Screen app; add a person | Family screen lists them with **Link phone** |
| 2 | Link the second phone (allow the camera on both) | Both scans work; the phone shows the welcome, then its inbox |
| 3 | While still connected, send from the linked phone | "Sent to …"; it is in the home base's inbox after **Done** |
| 4 | Apart: send, react, reply on the linked phone | **Waiting** in Sent; the sync status shows how many are waiting |
| 5 | Sync again | "Synced … N changes sent"; nothing arrives twice |
| 6 | Close both apps, lock the phones, reopen | Linked phone keeps its copy and queue; home base keeps everything |
| 7 | Refuse the camera on one phone, then try to sync | A clear message; note whether pasting a code still connects |
| 8 | Phones on a guest or "isolated" Wi-Fi, or with a VPN on | Expect failure; note what Connection details shows |
| 9 | Open the app in Safari as well as from the Home Screen | Separate data (expected); the Home Screen app is the one to use |
| 10 | Anonymous message from the linked phone | Not in the home base inbox for 1 to 6 hours, then shown with only a date |

## Trying it like an iPhone on this PC

Apple's iPhone Simulator only runs on a Mac, but this PC can run **Safari's engine (WebKit)** with an
iPhone's screen size, touch and user agent. That catches most layout and Safari-only problems before
you pick up a phone. One-time setup downloads WebKit (about 175 MB installed, from Microsoft's Playwright
servers):

```powershell
node node_modules/playwright-core/cli.js install webkit
npm start                  # the hub, in another window
npm run iphone             # an iPhone 15 window on http://localhost:3000
npm run iphone dark landscape device "iPhone 15 Pro Max"
npm run iphone http://192.168.1.20:3000 fresh    # another address; start with empty storage
```

The window keeps its storage between runs (in `data/iphone-sim`), like a phone, so you stay signed
in; `fresh` starts over. Options are plain words, because PowerShell drops npm's `--`.
`npm run test:iphone` runs the same engine headless through sign-in, giving, a kid writing a
grown-up style, asking and answering, notifications and one shared device, and fails on any error.

What it **can't** show (use a real iPhone, see the next section, or a Mac's Simulator):

- **Add to Home Screen** and the app running on its own. So no Web Push either: the app shows its
  "add the app to your Home Screen" explanation, as Safari on an iPhone does.
- **Phone sync:** this Windows build of WebKit has no WebRTC, so a phone home base can't link phones.
- iOS itself: the on-screen keyboard pushing the page up, the notch and Home bar (safe areas), Apple's
  fonts and emoji (it uses Windows ones), the camera, and real touch scrolling and momentum.

Online device clouds (BrowserStack, LambdaTest) can run real iPhones from a browser, but the app's
data would pass through their servers: use only made-up demo data there.

## Quick start (home hub)

```powershell
cd echoes
npm install
$env:HOST = "0.0.0.0"; npm start      # PowerShell
HOST=0.0.0.0 npm start                 # macOS / Linux / Chromebook Linux
```

The console prints the address phones should use, for example
`http://192.168.1.20:3000`. Open it, set up your family (choose **Home hub**), and
you become the first parent. Your firewall may ask to allow Node.js on private networks.

Without `HOST=0.0.0.0` only the computer running the hub can open it, and the app
warns you when you try to invite a phone.

| Setting      | Default              | Meaning |
|--------------|----------------------|---------|
| `PORT`       | `3000`               | Port to listen on |
| `HOST`       | `127.0.0.1`          | `0.0.0.0` lets phones on your Wi-Fi connect |
| `DATA_PATH`  | `data/family.json`   | Where the family's data is saved (written atomically) |
| `PUBLIC_URL` | auto-detected LAN IP | Address put in invite links, e.g. `https://feedback.home.example` |
| `ALLOWED_HOSTS` | (none) | Extra host names the hub answers to besides IP addresses and local names, comma-separated |

Do not expose the hub to the internet: it is designed for a trusted home network.
For notifications on phones, start it with `npm run start:https` instead (next section).

### Notifications

Phones and Chromebooks can get a notification when something new arrives for that person: a
message, a reply or reaction to something they sent, a cheer or a "noticed a change" on their
plan, or a request to say whether they've noticed a change.
The notification only ever says **"You have something new."** Who it's from and what it says stay
on the hub; the app shows them when it's opened.

Without notifications (turned off, or Safari on an iPhone before the app is on the Home Screen)
the app still keeps up: it catches up whenever you come back to it, and on the hub its tab badges
refresh every 30 seconds while it's open and whenever you tap a tab. If you're typing, only the
badges change, so nothing you're writing moves. A catch-up in the background doesn't count new
replies as seen: they stay marked New until you look.

1. Start the hub over https: `npm run start:https`. It uses the same family data as `npm start`
   and needs `openssl` (Git for Windows includes it). It prints the app address, for example
   `https://192.168.1.20:3443/`, a setup page, `http://192.168.1.20:3080/`, and the family
   certificate's **SHA-256 fingerprint**.
2. On each iPhone, open the **setup** page in Safari and trust the family certificate: download
   it, and in **Settings → Profile Downloaded → More Details** check that its SHA-256
   fingerprint matches the one on the hub computer's screen (if not, delete it and stop). Then
   install it and turn it on in **General → About → Certificate Trust Settings**. Do this on your
   own Wi-Fi only: the setup page is plain http, and the fingerprint is what proves the
   certificate is your hub's. On a Chromebook, download it from the setup page and import it
   as a trusted authority under Chrome's *Settings → Privacy and security → Security → Manage
   certificates*.
3. Open the app address. On iPhone, **Add to Home Screen** and open it from there; iPhones
   need iOS 16.4 or later.
4. **Family → Notifications → Turn on notifications**, and allow them. **Send a test** checks
   the whole path.

What to know:

- The hub sends each device a tiny encrypted ping through the push service its browser uses
  (Apple, Google, Mozilla or Microsoft; it sends nowhere else). The push service learns that a
  device got a ping and when, not what it is about.
- The hub computer must be online for pings to leave; messages themselves stay on the hub.
  Away from home the notification still shows straight away; the app-icon count catches up
  back on the home Wi-Fi. If the internet or a push service is down, the hub tries again with
  growing waits for up to a day, even across a restart. A phone that was offline gets one ping,
  not a pile.
- **Anonymous** messages wait a random **1 to 3 hours** on the hub before they show, and ping
  only then, so neither the message nor its ping appears just as the sender puts their phone
  down. Other pings in the meantime don't reveal them. The sender is told when they send it.
  Each person gets at most one ping every 30 seconds. Nothing waiting is lost if the hub restarts.
- The hub's certificate renews itself (it lasts a year; the hub checks daily), and if the
  computer gets a new address on the home network the hub notices within minutes, makes a
  certificate for it and prints the new address. The family certificate you trust on each
  phone lasts ten years; the hub warns 60 days before it expires, and after that makes a new
  one that each phone trusts again from the setup page.
- Notifications belong to one person on one device. **Switch** on a shared device turns them
  off there for the person who was signed in; removing someone deletes their devices. A new
  PIN signs that person out on their other devices and stops notifications there.
- If an iPhone's notifications stop (its push service can end a subscription, and iPhones
  can't renew one by themselves), Family → Notifications says so; **Turn on** sets up a new one.
- Where the device supports it, the app icon shows how many things are new.
- With a phone as home base or one shared device there is no always-on computer to send
  pings, and the Family screen says so.
- `PUSH_CONTACT` (a `mailto:` or `https:` address) is the contact the push services may use if
  something is wrong with your pings; the default is a placeholder. `HTTPS_PORT` (3443) and
  `HTTP_PORT` (3080) change the ports; `--host <ip>` picks the address if the computer has several.

### Running the hub on a Chromebook

Turn on **Linux development environment** in ChromeOS settings, install Node.js 20+
in the Linux terminal, and run the commands above. ChromeOS forwards the port to
the Chromebook itself; for other phones to reach it, enable **Port forwarding**
for the port in *Settings → Developers → Linux → Port forwarding*. An always-on
Mac, PC or Raspberry Pi is usually simpler.

## Quick start (one shared device)

Choose **Only this device** on the hub's setup screen, or open the app from a static
host (any static web host, GitHub Pages or `npx serve public`): when no hub answers,
the app starts in this mode by itself. Everything stays in that browser.

- **iPhone/iPad:** add it to the Home Screen (Share ⬆️ → *Add to Home Screen*).
  iOS may clear website data you don't use for a while; Home Screen apps are kept.
- **Chromebook:** click *Install* in Chrome's address bar.
- Parents should use **Family → Download backup** now and then. The backup file
  contains everyone's messages, so keep it private.
- To keep inboxes private on a shared device, the app signs the person out after
  **3 minutes without a tap**, or when it comes back after **a minute or more in
  the background**. Drafts and on-screen messages are cleared at the same time.

A phone that has used a hub never silently switches to an empty on-device family.
If the hub is off, it shows "Can't reach the family hub" with a retry button.

## Bringing family members in

Everyone gets a **picture**: pick one from a grid of default-tone emoji (no skin colour; people who
aren't a particular gender come first), or tap **Type your own** for any emoji. People can change
their own picture under **Family → My profile**.

**Removing someone:** a parent opens **Family** and taps **Remove** next to the person. It deletes
their inbox and their plans, unlinks their phones, and keeps the messages they sent (now from a
"Former member"). Only parents see Remove; you can't remove yourself, and the family always keeps
at least one parent. A guest can instead be given an end date.

1. A parent opens **Family**, adds the person (or taps **📲 Invite** next to someone
   already listed). In hub mode, adding someone opens their invite right away.
2. The invite shows a **QR code**. Hold the phones together and have the new person
   point their iPhone or Chromebook camera at it. You can also send the link with
   **Share… (AirDrop, Messages)**, **💬 Text it** or **Copy link**.
3. Opening the link signs that phone in as that person. They see a **welcome screen**
   with the family promise ("we give feedback to help, never to hurt", with a kid
   version for kids), can pick a PIN, and get steps for adding the app to their home screen.

Invite links work **once** and expire after **7 days**. Anyone holding the link can
sign in as that person, so send it only to them.

### What about the iPhone "bump" (NameDrop)?

NameDrop only swaps contact cards between iPhones, and Apple doesn't let websites
use it, so a web app cannot start from a bump. The closest options:

- **QR code:** works on every iPhone and Chromebook; just hold the phones near each other.
- **AirDrop:** the **Share…** button opens the iPhone share sheet. Browsers only allow
  this on secure pages (`https://` or `localhost`), so on a plain `http://192.168…` hub
  the button is hidden on phones and you'll see **Text it** and the QR code instead.
  To get Share/AirDrop (and offline support) on phones, put the hub behind HTTPS and set `PUBLIC_URL`.

### Guests

Tick **Guest** when adding someone who is visiting, such as grandparents, a cousin
or a sitter, and optionally set **Guest until**. Guests:

- can give and receive feedback one-to-one or in a group,
- are **not** included when someone sends to **Everyone**,
- can't be parents, and
- can't sign in after their end date. A parent can extend the date or remove them.

## Sending: one person, a few people, or everyone

The **Give** screen starts with **👤 One person / 👥 A few people / 📣 Everyone**.

- **One person:** private, between you two.
- **A few people:** each person gets their own copy and can react or reply privately.
  Named messages show who else got them ("to you and Ava").
- **Everyone:** every active family member except you (not guests).

Your **Sent** list groups each message and shows, per person, whether it was read,
their reaction and any reply. New reactions and replies also appear at the top of your
**Inbox**, under **Replies and reactions**, and count in its badge until you have seen them. Tap
one to jump to that message in Sent; opening Sent or **Mark all as seen** clears them.

## Asking for feedback

Feedback doesn't have to wait for someone to think of it. On **Give**, switch from **Give** to
**Ask** to ask about something you did:

1. **Your question:** what you did ("I ran the bake sale stall on Saturday", up to 300
   characters) and what would help most: **What went well**, **One thing to try** or **Both**.
2. **Ask:** one person, a few people or everyone (not guests).
3. **How should they answer?** Any feedback style. Everyone answers in it, kids included; if you
   pick a style made for grown-ups and ask a kid, a note suggests an easier one.
4. **Send it:** when you ask **3 or more people** (and the family allows anonymous feedback),
   you can let them answer anonymously. Then every answer is anonymous and uses the style you
   picked, so neither a name nor a style points to anyone. (When answers carry names, people
   may answer in another style if they prefer.)

The people you asked see **Questions for you** at the top of their Inbox, and it counts in the
badge and sends a notification like any new message. On a desktop the question opens in the
reading pane; on a phone or tablet it opens in place. **Answer with …** opens Give, ready for you
with the question shown above it; the answer is an ordinary message to the asker that says which
question it answers, so they can make a plan from it. **Not now** removes the question for good,
and the asker isn't told.

In **Sent**, **Your questions** shows how many people have answered. When answers carry names,
you see who answered and who you're still waiting for (someone who chose Not now still shows as
waiting). When answers may be anonymous, you only see how many have arrived. **Stop asking** takes
the question out of everyone's Inbox; answers that already arrived stay. On a linked phone,
questions, answers and Not now made apart are checked the same way and sent at the next sync.
The rules are in `public/shared/asks.js` and `public/shared/core.js`.

## After feedback arrives: a break, then a plan

**A short break before replying.** When someone first opens a message, writing back waits
**30 minutes** for grown-ups and **10 minutes** for kids. During the break they can still tap
**Thank you**, **Got it** or **Let’s talk**. **I see it differently**, a written reply and
making a plan wait until it's over. The message shows a countdown and a prompt ("What is one
part that’s true?"); kids breathe along with a bubble and "Breathe in / Breathe out". On a device
set to reduce motion (iPhone Reduce Motion, or Windows with animation effects off) the bubble
fades in and out instead of growing. The break is a nudge built into the
app's rules, not a lock. On a linked phone it counts from when the message was opened on that
phone, even while apart.

**Turning feedback into a plan.** After the break, **Make a plan from this** turns the message
into one small promise:

- **What I heard**, in your own words, so the giver knows the point landed;
- **My promise**, and one **When I…, I’ll…** step ("When I feel rushed, I’ll take a breath
  and say we need to go in five minutes");
- **7, 14 or 30 days**.

The **Plans** tab shows today's **Kept it / Not today** and a strip of every day (tap a past
day to change it). Halfway through comes a short private **check-in** (going well, okay,
hard). On the last day a **wrap-up** asks what's next: **finish**, **keep going** for another
round, or **change the plan** for a new one. Each person has at most two plans going, and the
Plans tab shows a badge when something is due today.

**Who sees it.** A plan is private unless its owner shares it with the person who gave the
feedback, or with the whole family (not guests). They can change this later.

| | The owner | Anyone it's shared with |
|---|---|---|
| The promise, the When I…/I’ll… step, what I heard | ✓ | ✓ |
| Day count and how many days went well | ✓ | ✓ |
| Which days were missed, and the check-ins | ✓ | never |
| Cheers | ✓ | ✓ |

A plan made from an **anonymous** message can be private or shared with the family, never
"with the giver", because the app doesn't know who sent it.

**Cheers and closing the loop.** Anyone who can see a plan can tap **👀 I noticed**,
**🙌 Proud of you** or **💪 Keep going**, once a day. At the wrap-up, the owner can ask the
person who gave the feedback "Have you noticed a difference?", and the answer shows on the
finished plan. The giver's **Sent** list also shows when someone made a plan from their
message.

**Kids** get a picture version. They pick one of eight promises, such as 🤫 *Use my calm
voice*, whose When I…/I’ll… step is filled in for them and can be changed. Plans last 7 or
14 days, kept days earn star stickers, and a grown-up **helper** sees the promise and can
cheer, even when it's private.

The rules are in `public/shared/plans.js`. The hub, a shared device and a linked phone all
use them, so changes made apart are checked the same way and arrive intact at the next sync.

## Feedback styles

| Style | For | Steps |
|---|---|---|
| 🧸 **Kind Words** | Made for kids | Feelings (pick all that fit) → what happened → next time, could you… → something I like about you |
| 🌱 **Glow & Grow** | Everyone | One thing they did well, one thing to try next time |
| 💌 **Thank-You Note** | Everyone | What they did → how it helped |
| 🧭 **DEAR MAN** (DBT) | Made for grown-ups | **D**escribe, **E**xpress, **A**ssert, **R**einforce, **N**egotiate, with **M**indful and **A**ppear confident as delivery tips |
| 🎯 **Situation-Behavior-Impact** | Made for grown-ups | Situation → behavior → impact → optional request |
| 🕊️ **Nonviolent Communication** | Made for grown-ups | Observation → feelings → need → request |

**Everyone can use every style, kids included.** Kid profiles get bigger buttons and text and see
the kid-friendly styles first; a style made for grown-ups says it has more steps and suggests
asking a grown-up to help. If any recipient is a kid, kid-friendly styles are listed first.

**Examples as ghost text.** Every box in every style shows a worked example in grey, so it's
clear what to write: kids see examples from a kid's life ("Yesterday you came into my room
without knocking."), grown-ups see grown-up ones. **Show another** switches to the next example.
The grey text is never filled in or sent. Add or change styles and their examples (`EXAMPLES`)
in `public/shared/models.js`.

**Look and appearance.** The app takes its cues from the iPhone's own Messages and Settings
apps: large titles, grouped lists with hairline separators, round contact-style pictures, and
thin line icons (emoji are kept for people, feelings, reactions and feedback styles). The top-bar
button opens a picker with three colour themes: **Messages** (the default, iPhone-like greys and
blue), **Graphite** and **Paper**. Each has light and dark; mode follows the system
unless set to Light or Dark. Both choices are saved per device, and the browser and home-screen
bar colour follows them.

**Phone, tablet and desktop.** Phones and tablets get one column with a tab bar at the bottom.
On a laptop or desktop (1100px and wider) the app uses the width: the Inbox shows the list with a
reading pane beside it, Give puts choosing on the left and writing on the right, and Plans, Sent,
Family, the Guide and Make a plan use two columns. Resizing keeps the open message and anything
being written. The details, and the rules for future changes, are in
[docs/design.md](docs/design.md).

**Tone helper.** Gentle hints appear for phrases like "always/never", "you are so
lazy", "you should" or ALL CAPS. Hurtful words such as "stupid" or "shut up" are
**blocked** in anonymous feedback and whenever a kid is among the recipients; otherwise
they need a deliberate "Send as is". The word list is in `public/shared/tone.js`.

## Anonymity: what it does and doesn't promise

What it promises: once a message is stored, **no sender is recorded with it**. Everything
else below only makes guessing harder.

- No sender id is stored, so the app can't look it up later, not even for parents or
  whoever runs the hub.
- Only the family's local **date** is stored, not the time. Anonymous messages also get a random
  id and a random place in the stored list, so they can't be dated by the named messages around
  them.
- Anonymous messages are not in the sender's **Sent** list, cannot be replied to, their
  reactions never reach the sender, and they **never show who else received them**. With "Everyone", the one person missing
  from the list would be the sender.
- Limits: in a small family, writing style and context can give people away. In
  device-only mode, anyone who can open the browser's developer tools on that device
  can read the stored data. Parents can turn anonymous feedback off.
- **Home hub:** anonymous messages are held for a random **1 to 3 hours** and then show up
  together with their notification, so the moment a message (or a ping) arrives doesn't point to
  whoever just put their phone down. While a message is held, the hub's file holds the time it
  will show; that time is removed once it shows. On one shared device they show at once.
- **Phone as home base:** a linked phone keeps its anonymous message, next to its own
  person's details, until the next sync. The parent doing the sync knows whose phone it
  was, so they can still suspect the sender. To make that harder, the home base waits a
  random **1 to 6 hours** before showing anonymous messages that arrive through a sync;
  anyone who inspects the home base's storage can see them sooner.
- **Questions you asked:** anonymous answers are possible only when you ask 3 or more people.
  You then see how many answers have **arrived** (a held answer counts only once it shows, so its
  timing doesn't point to anyone), never who answered or who chose Not now. The app does keep a
  list of who is finished with each question, answered or Not now mixed together, so it can take
  the question out of their Inbox; that list is never shown to the asker. Every answer to such a
  question is anonymous and in the style asked for, because one named answer, or one answer in a
  different style, would show who wrote the others. If anonymous feedback is turned off,
  or removing someone leaves fewer than 3 people asked, the question closes.

## Privacy and permissions

- Only the recipient can read a message. Parents can't read other people's inboxes in the app.
- Plans are private unless their owner shares them. Missed days and check-ins are never shown
  to anyone else.
- Parents add, edit, invite and remove members, reset PINs and change settings. The
  family always keeps at least one parent.
- Everyone else can change only their own name, emoji and PIN (current PIN required).
- PINs are salted and hashed (scrypt on the hub, PBKDF2 on the device). Five wrong tries lock that
  profile for a minute; each further wrong try doubles the wait (up to an hour), and the count is
  kept with the family's data, so a restart doesn't reset it. Changing your own PIN checks your
  current one against the same limit. On the hub, setting, changing or removing a PIN signs
  that person out on their other devices and stops notifications there (when they change it
  themselves, the device they used stays signed in).
- A phone becomes someone with a PIN only once they type it: when an invite is opened on the hub,
  or before **Link phone** starts on a home base. So a parent can't open a teenager's inbox on
  another phone. Without a PIN, anyone who can open the hub can sign in as that person by tapping
  their picture, so give everyone old enough a PIN.
- A linked phone hands its key only to a home base that proves it already knows the link, and
  never syncs with another family's home base.
- The hub's API only answers to an IP address or a local name (`my-pc`, `my-pc.local`), so a web
  page can't reach it by pointing its own domain at your computer (DNS rebinding). Use
  `ALLOWED_HOSTS` for any other name you use.
- Hub sessions use an `HttpOnly`, `SameSite=Strict` cookie (also `Secure` over https). The API
  only accepts JSON and sends a strict Content-Security-Policy. Each person keeps at most 20
  sign-ins (the oldest goes first), and none lasts more than a year.
- On the hub, signing in by tapping your picture is treated as a **family computer**: it ends when
  the browser closes and after 3 minutes without a tap. Tick **Keep me signed in on this device**
  on your own phone or computer. Phones that join with an invite stay signed in.
- Notifications are off until someone turns them on for their own device. A ping carries no
  names or words, and backups never include the hub's notification keys or devices.

## Development

```powershell
npm test               # hub API + shared core (device mode) + phone sync tests
npm run screenshots    # headless Edge walkthrough on iPhone and Chromebook sizes, light and dark
npm run test:browser   # headless Edge theme checks: Messages/Graphite/Paper x System/Light/Dark
npm run test:peer      # headless Edge: two phones link and sync over real WebRTC
npm run test:plans     # headless Edge: the break, grown-up and kid plans, ticks, cheers, wrap-up
npm run test:layout    # headless Edge: phone, foldable/tablet and desktop layouts, measured
npm run test:push      # headless Edge: notifications on, a ping, the service worker, off
npm run test:push-live # optional, online: one real ping through Microsoft's push service
npm run test:privacy   # headless Edge: what one person can learn about another; what a shared device leaves behind
npm run test:stress    # a big family, thousands of messages at once, PIN guessing, hostile bodies, a long inbox
npm run test:asks      # headless Edge: asking for feedback, answering (grown-up and kid), Not now, anonymity
npm run test:styles    # headless Edge: kids using every style, example ghost text, Show another
npm run test:iphone    # headless WebKit (Safari's engine) at iPhone 15 size: hub, kid, asking, one device
npm run test:conversation  # two iPhones (WebKit) talk to each other through the hub, start to finish
npm run test:get-echoes    # headless Edge: the Get Echoes code on the home base, and where #/link leads
npm run iphone         # an iPhone-sized WebKit window on the hub, to try it by hand (see above)
npm run start:https    # the home hub over https, for notifications (see Notifications)
npm run serve:https    # https test copy on this computer for real iPhones (see above)
npm run vendor         # copy the QR libraries into public/vendor after npm install
node scripts/icons.mjs # re-render PNG app icons from public/icons/icon.svg
```

`npm run test:peer` serves `public/` as static files from a sub-path, like GitHub Pages,
and gives each phone its own browser profile. It reads each QR code off the screen,
pastes it into the other phone, and checks linking, the welcome, live messages,
queueing while apart, a reload, syncing again, that an unlinked phone is refused, the
idle sign-out and the one-window rule. Pass a folder to save light and dark screenshots.
It hides Chromium's private `.local` addresses by default; `PEER_MDNS=1` keeps them,
which is closer to Safari. Neither replaces testing on real iPhones.

`npm run screenshots` needs Microsoft Edge. It seeds a demo family and drives the real
UI: invites and the welcome screen, audiences, device-only mode with IndexedDB
persistence across a reload, and the hub-offline screen. It fails on any browser
console error and writes `screenshots/echoes-board.png`.

`npm run test:browser` also needs Edge. On a light and a dark system it checks every theme
and mode, the browser bar colour, a live system change, the choice surviving a reload and
going offline, the keyboard focus ring and the picker's selected state.

`npm run test:plans` also needs Edge. It moves the hub's clock and each page's clock forward
together, so it can check the 30- and 10-minute breaks, a grown-up's plan shared with the
giver, a kid's picture promise with a helper, ticks, a cheer, the halfway check-in and the
wrap-up in seconds. It writes a dark-above-light board to `screenshots/plans/plans-board.png`.

`npm run test:layout` also needs Edge. At 390 × 844, 744 × 900 and 1440 × 1000, in light and
dark, it checks every main screen for sideways scrolling, the page width, columns side by side on
desktop and stacked below it, 44px touch targets, the Inbox reading pane and that the open
message and drafts survive a resize. It writes one board per screen (dark above light) to
`screenshots/layout`.

`npm run test:push` also needs Edge. Headless browsers can't subscribe to a real push service,
so it stands in for the browser's subscription with a test key pair and a fake push service;
the hub, the encryption and the service worker are real. It checks turning notifications on,
that a new message sends one ping holding only `{"t":"new"}`, that the service worker shows
"You have something new.", that it still does at once when the hub can't be reached (away from
home), Send a test, that Switch unsubscribes the browser as well as the hub, that a device the
hub let go says notifications stopped and Turn on makes a fresh subscription, that a PIN change
keeps this device's notifications, Turn off, and the explanations on an iPhone
outside the Home Screen and when notifications are blocked. It writes boards of the
Notifications section to `screenshots/push`. Real iPhones still need trying by hand.

`npm run test:push-live` is optional and needs the internet: headless Edge subscribes for real,
and one content-free ping goes through the push service Edge uses (Microsoft's on Windows) and back
to the service worker, which proves the push service accepts the hub's signature and encryption.

`npm run test:privacy` needs Edge. It checks that an anonymous message can't be dated by its id or
its place among named messages, that nobody (parents included) can open someone else's messages or
unshared plans, that a reaction to an anonymous message reaches nobody, and on a family computer
that Switch and Back leave nothing of the last person on screen, in storage or in caches, that a
sign-in from the person tiles ends with the browser and after 3 idle minutes, and that "Keep me
signed in" keeps it.

`npm run test:stress` needs Edge and takes about a minute. On a throwaway copy it builds a family of
30, sends 3,000 messages 100 at a time, and checks nothing is lost and anonymous messages keep no
sender or time. It reads 500 inboxes at once, sends 60 wrong PINs at once (only 5 may be tried), and
sends hostile bodies (600 KB, broken JSON, form posts, `__proto__`, huge fields and recipient
lists). It signs one person in 300 times (sessions stay capped) and pings 87 devices, then opens a
1,000-message inbox in the browser. It fails if sends or reads get slow (p95 over 1.5 s) or the hub
stalls for more than a second; `--report` prints the numbers without failing.

`npm run test:asks` needs Edge. Ava asks Dad and Sam about something she did. It checks the
Give / Ask switch, that the question is required and kept on reload, the kid note, and that
anonymous answers need 3 people, and the hint when a kid is asked with a grown-up style. Sam (a kid)
sees the question in his Inbox and badge, opens it in place, sees a kid's example as ghost text, tries
DEAR MAN and answers with Kind Words. Dad opens it in the desktop reading pane, sees
there is no anonymous option, and chooses Not now. Ava sees the answer linked to her question and
"Sam answered · waiting for Dad" in Sent. Then an anonymous question to everyone, Sam included:
everyone answers in the style Ava picked, a named answer is refused, Dad's answer can't be switched to named,
held answers aren't counted until they show, and Sent never names anyone. **Stop asking** takes it out of every
Inbox. It also asks and answers on one shared device and reloads, and checks there's no sideways
scrolling. It writes dark-above-light boards for asking, a question arriving, answering, Sent, and
asking and answering without names, at phone, foldable and desktop sizes, to `screenshots/asks`.

`npm run test:styles` needs Edge. A kid sees every style, kid-friendly ones first, gets the hint on
DEAR MAN with a kid's example, moves through the examples (kept on reload, wrapping round) and sends
DEAR MAN; the message arrives without any ghost text. A grown-up sees grown-up examples. It writes
dark-above-light boards at phone, foldable and desktop sizes to `screenshots/styles`.

`npm run test:iphone` needs WebKit (see Trying it like an iPhone on this PC). It writes
`screenshots/iphone/iphone-board.png`.

`npm run test:conversation` also needs WebKit. Two iPhones, each with its own storage, talk
through one hub. Mom sets the family up and adds Sam, a kid. Sam joins from the invite on his
phone, then they go back and forth: a thank-you and a reaction, feedback with the break before
replying, a reply and a promise with Mom as helper, a cheer and a tick, a question and its answer,
and Sam writing DEAR MAN. Neither phone is reloaded: each only learns of new things when it's picked
up again or, while it's open, from the 30-second badge refresh. It writes a two-part storyboard of
both screens at each step to `screenshots/conversation`.

`npm run test:get-echoes` needs Edge. On a home base served from a sub-path like GitHub Pages, it
checks that Link phone starts with a QR code of the app's address plus `#/link` (decoded from the
picture), with no camera or sync code until **Next**, then the sync code as before. It checks where
`#/link` leads: iPhone Safari to the Add to Home Screen steps, an iPhone Home Screen app and a
Chromebook straight to Link this phone, a device with a family to the app as usual. It writes boards
to `screenshots/get-echoes`. `npm run test:peer` follows the whole path with two phones over WebRTC.

For agents and contributors: [AGENTS.md](AGENTS.md) has the house rules, [docs/design.md](docs/design.md)
the design contract, and [.agents/skills](.agents/skills/README.md) the agent skills: design and UI,
testing (which checks to run, writing a check, play tests, mutation checks,
iPhone simulation) and changing the shared rules safely (with a privacy review).

Architecture diagrams, with animated tours of sending feedback and inviting someone,
are in [docs/architecture](docs/architecture/README.md).

```text
src/server.js            Home hub: HTTP(S), sessions, invites + QR, JSON file storage
src/push.js              Web Push from the hub: encryption, VAPID, which push services, timing
scripts/start-https.mjs  The hub over https, with the family certificate (scripts/local-certs.mjs)
public/shared/core.js    All app rules, shared by the hub and device-only mode
public/shared/store.js   Tiny document store (hub: JSON file, device: IndexedDB)
public/shared/models.js  Feedback styles
public/shared/tone.js    Tone helper
public/shared/plans.js   The break before replying, and plans made from feedback
public/shared/asks.js    Asking for feedback: what would help, anonymous answers only from 3 people, kids answer with Kind Words
public/shared/errors.js  HttpError, used by all the shared rules
public/shared/peer-host.js    Home base side of phone sync: links phones, proves itself, answers them
public/shared/peer-client.js  Linked phone side: live requests, its copy, the queue
public/shared/signal.js  Sync codes (compressed WebRTC offer/answer)
public/peer-link.js      WebRTC data channel, the home-base check, QR drawing and camera scanning
public/peer-backend.js   Linked phone storage (IndexedDB)
public/vendor/           qrcode-generator (MIT) and jsQR (Apache-2.0), from npm run vendor
public/local-backend.js  Device-only mode: IndexedDB + PBKDF2 PINs
public/app.js            The UI's start-up: listeners, timers, the first render (no framework)
public/ui/state.js       What the app knows now (signed-in state, UI state, the draft); setters
public/ui/dom.js         Icons, the page's fixed elements, escaping, toasts, small text helpers
public/ui/backend.js     Which backend answers: hub, this device / home base, or a linked phone
public/ui/router.js      Routing, top bar and tabs, banner, error screens
public/ui/welcome.js     Setup, sign-in, joining with an invite, the welcome screen
public/ui/inbox.js, give.js, sent.js, plans.js, family.js, guide.js, sync.js   One file per screen
public/ui/push.js        Notifications on this device;  public/ui/theme.js  Appearance
public/ui/actions.js, forms.js   What taps, changes and form submits do (data-action, data-form)
public/sw.js             Offline app shell (secure contexts only)
public/manifest.webmanifest, public/icons/   Install on iPhone and Chromebook
```
