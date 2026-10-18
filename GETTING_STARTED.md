# Getting started: try the demo on your iPhone

This guide installs the two demo apps on your own iPhone: the **wallet**
(ChildSafeWallet) and the demo content app (**Footube**). You don't need to run
the age checker yourself; you'll connect to the one the project team runs.

Allow about **45 minutes** the first time. Most of it is downloads and the first
build.

## Before you start

**This demo works on iPhone only for now.** Android isn't supported yet, and the
iOS Simulator can't run the face check.

You need:

| | Requirement |
|---|---|
| A Mac | Any recent Mac with about 30 GB of free space |
| An iPhone | With **Face ID** (iPhone X or newer), on a recent iOS version |
| A cable | To connect the iPhone to the Mac |
| An Apple ID | A normal, free one is enough |
| The age checker's address | Ask the project team. It looks like `https://something.example.com` |

## Step 1: install the tools (one time)

1. **Install Xcode** from the Mac App Store. It's large, so this takes a while.
2. **Open Xcode once** and let it finish installing its extra parts. If it asks to
   download iOS support, say yes.
3. **Sign in to Xcode with your Apple ID:** Xcode → Settings → Accounts → **+** →
   Apple ID.
4. **Install Homebrew** by following the one-line instruction at
   [brew.sh](https://brew.sh).
5. **Install Node.js, CocoaPods and Git** by opening the Terminal app and running:

   ```bash
   brew install node cocoapods git
   ```

## Step 2: prepare your iPhone (one time)

1. Unlock the iPhone and connect it to the Mac with the cable.
2. If the iPhone asks **"Trust This Computer?"**, tap **Trust** and enter your
   passcode.
3. Turn on **Developer Mode**: on the iPhone, go to Settings → Privacy & Security →
   **Developer Mode** → turn it on. The iPhone restarts; confirm when it asks.

   If you don't see Developer Mode, open Xcode on the Mac with the iPhone
   connected, wait a minute, and look again.

## Step 3: download the code

In Terminal:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/SaarthSingla/Child-Safety-in-AI.git
cd Child-Safety-in-AI
```

The first part (`GIT_LFS_SKIP_SMUDGE=1`) skips downloading the age checker's
large AI model, which you don't need to test the apps.

## Step 4: give the apps your own name (one time)

Apple requires every app's ID to be unique, and the IDs in this code are already
taken by the original developer. Choose a short word that's unique to you, such
as your name plus a number, using only letters and numbers. Then run this,
replacing `yourname` with it:

```bash
sed -i '' 's/com.anonymous/com.yourname/' wallet/app.json platform/app.json
```

For example, `sed -i '' 's/com.anonymous/com.priya42/' wallet/app.json platform/app.json`.

## Step 5: install the wallet

Keep the iPhone **unlocked and connected**. In Terminal:

```bash
cd wallet
npm install
npx expo run:ios --device --configuration Release
```

- When asked which device to use, pick your iPhone.
- If asked to choose a signing team, pick the one with your name.
- The **first build takes 10 to 20 minutes**. Later builds are much faster.

At the end, Terminal will probably show an error saying the app **can't be
opened because it isn't trusted**. That's expected the first time. On the
iPhone:

1. Go to Settings → General → **VPN & Device Management**.
2. Tap your Apple ID under "Developer App".
3. Tap **Trust**.

Now open **ChildSafeWallet** on the iPhone.

## Step 6: install Footube

Still in Terminal:

```bash
cd ../platform
npm install
npx expo run:ios --device --configuration Release
```

Pick your iPhone again. You don't need to trust anything this time.

Both apps now run on their own; you can unplug the iPhone.

## Step 7: connect the wallet to the age checker

1. Open **ChildSafeWallet** and go to the **Settings** tab.
2. Paste the age checker's address into **Issuer Base URL**.
3. Tap **Save Issuer URL**.

## Step 8: try it

**A. Get your age token**

1. In the wallet, tap **Get Age Credential**, then **Continue**.
2. Allow camera access.
3. Follow the prompts on screen: blink, smile, and so on, then look straight at
   the camera. Use good lighting and keep only your face in the frame.
4. The home screen now shows your age range.

**B. Prove your age to Footube**

1. Open **Footube** and tap an article marked **12+**, for example *Sleep, Screens
   and the Teenage Brain*.
2. Tap **Verify with ChildSafe Wallet**. The wallet opens and shows what Footube
   is asking for.
3. Tap **Approve**. You're taken back to Footube and the article opens.

Articles marked **18+** open only if your age token says 18+.

**C. Add a parent rule**

1. In the wallet, open the **Policies** tab and set a 4- to 6-digit PIN.
2. Under **Custom policy**, choose **Health**, leave it on **Always**, and tap
   **Add policy**.
3. In Footube, open *Sleep, Screens and the Teenage Brain* (a Health article) and
   tap **Verify with ChildSafe Wallet**. The wallet shows **Blocked on this
   device**, and the article stays locked.
4. Open *Cyberbullying: How to Spot It and What to Do* (a Society article). It
   still works.

## If something goes wrong

| What you see | What to do |
|---|---|
| An app says **"no longer available"**, or won't open after about a week | Free Apple accounts only allow apps to run for **7 days**. Connect the iPhone and run Steps 5 and 6 again. |
| **"Untrusted Developer"** | Repeat the Trust steps at the end of Step 5. |
| **"Failed to register bundle identifier"** or a similar signing error | The app name isn't unique. Repeat Step 4 with a different word. |
| Terminal says the iPhone is **locked** or **unavailable** | Unlock the iPhone, unplug and replug the cable, tap Trust if asked, then run the command again. |
| The wallet says **"Device not supported"** | The iPhone has no Face ID. Use an iPhone X or newer. |
| Getting the age token fails, or Footube says the signature is invalid | The age checker may have restarted. Each restart creates a new signing key, which has to be updated in the code. Ask the project team for the latest code and address. |
| The face check keeps failing | Use even, bright light, hold the phone at arm's length, and do each action clearly. Photos and screens are rejected on purpose. |

## Running your own age checker (optional, advanced)

Most testers can skip this. The age checker in `issuer/` is a Python server.
Its AI model needs a powerful computer (the team runs it on a cloud server with a
graphics card), and the model file is about 330 MB, stored with
[Git LFS](https://git-lfs.com) and available to project members only. See
`issuer/RUNNING.md`.

It isn't plug-and-play yet: the age checker creates a **new signing key every
time it starts** and doesn't publish it. Each time, that key has to be copied
into `wallet/src/crypto/sdJwt.ts` and `platform/src/verifier/config.ts`, and both
apps rebuilt. The wallet also only connects to `https://` addresses.
