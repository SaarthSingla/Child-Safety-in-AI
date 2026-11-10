# Family Rules for the CHAISE Child Safety Demo

> **Work in progress.** A parent writes a rule in plain words. A child's phone
> then applies that rule to the content apps want to show. The code is a demo
> and is not ready for real families.

## The journey of a rule

1. **The parent writes a rule**, such as "hide war news from 9 pm to 6 am". Hindi
   and Hinglish work too.
2. **An AI reads the sentence** and fills in a form. If the meaning is unclear,
   it asks a question. "School nights" always gets a question, because every
   family means something different.
3. **Normal code checks the form.** Anything unknown or unsafe is rejected.
4. **The parent sees the rule in plain words,** with examples of what will change.
5. **The parent approves it on their own device.** The device signs the rule.
6. **The server turns the form into precise rules** and tests them with Cedar, a
   rule engine built for this kind of job.
7. **The child's phone downloads the rules** and checks the signatures.
8. **An app asks about its content.** The phone decides *allow*, *ask* or *hide*
   for each item, then tells the app only that answer.

## Design decisions

### The AI fills in a form. It never decides.
AI can misunderstand things, and it can be tricked. So it can only choose from
fixed words on a form, and it has no way to allow anything. Every decision about
content is made by ordinary code that gives the same answer every time.

### The form is turned into rules by fixed code, not by the AI.
Tricky details, such as a window that crosses midnight, are written once and
tested. They aren't left for the AI to get right every time.

### The strictest rule wins.
Rule order never matters, so adding a rule can't quietly change another one. A
parent can relax a rule only by adding an exception to that rule.

### A few protections can't be turned off.
Adult content and serious harm stay blocked, whatever a rule says. Parents can't
delete these or add exceptions to them, and neither can an AI mistake.

### Missing labels don't mean safe, and they don't mean blocked.
Real apps often say very little about their content. Blocking everything
unlabelled would make feeds unusable, so the answer depends on what's at stake:

| Rule | Under 13 | 13 to 17 |
|---|---|---|
| Serious harm or age limits | Hide | Ask |
| A family preference like "no war news" | Show | Show |

A parent can make a preference stricter by saying that unlabelled content counts
too. The AI can't change this table, because code sets it.

### Unclear labels count as "not checked".
If a label uses a word the phone doesn't know, the phone treats that detail as
not checked. It never assumes the item is safe.

### Labels can unlock an exception only if they're signed.
Anyone can tag a violent film as "science". So an exception like "science is
fine" works only on labels signed by an approved labeller.

### A rule needs two signatures.
The server signs it and the parent's device signs it. If someone breaks into the
server, they still can't change a child's rules on their own.

### If anything fails, the phone becomes stricter.
- A broken or edited policy is refused.
- An old policy can't replace a newer one.
- If a rule fails to run, the item needs a parent's OK.
- If rules go a week without updating, the built-in protections stay on and
  everything else needs a parent's OK.

### Decisions happen on the child's phone.
The server never learns what the child is looking at. Apps receive only *allow*,
*ask* or *hide*, never the reasons. Answers end on the next quarter hour, so the
timing doesn't reveal bedtime either.

### A child can ask, and a parent's yes is an ordinary change.
Each approval is previewed, signed and recorded like any other rule. Approving an
unlabelled item only settles the unknown: if the item is later labelled as
harmful, it's blocked again.

## How it's organised

```
policy/     The shared rules: the form, checks, rule maker and signatures
nlpps/      The parents' website and server, including the AI step
wallet/     The child's iPhone app, which makes the decisions
platform/   Footube, a demo app that asks the wallet about its content
issuer/     The age checker (not changed by this work)
```

## Try it

```bash
cd policy && npm install
cd ../nlpps && npm install
cp env.example .env     # add a free key from console.groq.com
npm start               # then open http://localhost:8787
```

Parents' devices need `https` or `localhost` to approve rules. The steps for
installing the two iPhone apps are in [GETTING_STARTED.md](GETTING_STARTED.md).

To run the checks, use `npm test` in `policy`, `nlpps`, `wallet` and `platform`.
`npm run live-check` in `nlpps` sends real sentences to the AI.

## What isn't solved yet

- **Labels can be wrong.** A signature shows who made a label, not that it's true.
  Independent checks are still needed.
- **Topic matching is simple.** When an app sends no topic, the phone uses a short
  word list. A real on-device AI model should replace it.
- **Apps must take part and must obey.** The wallet can't see the screen. A
  certified app kit and audits are needed.
- **Moving data between apps is slow on iPhone.** Footube opens the wallet to ask,
  which doesn't suit an endless feed. Android allows a better way, but it isn't
  built yet.
- **A child can delete the wallet or change the phone's clock.** The clock can't
  be moved back past the last signed time, but deleting the wallet needs Apple's
  parental controls permission.
- **The website comes from the server.** A hacked server could serve a fake
  approval page. A separate parents' app would close this gap.
- **One parent per child, for now.** Teachers and second parents aren't included.
- **No screen-time limits yet,** such as "2 hours a day". These need a trusted
  way to measure usage.
- **Real parents haven't tried it.** The AI needs testing on many real sentences.
