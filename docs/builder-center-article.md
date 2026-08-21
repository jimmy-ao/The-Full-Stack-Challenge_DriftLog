# Full Stack Challenge: DriftLog

I hit the PartyRock word generator expecting something spicy. Dragon. Volcano. Something you could build a neon cyberpunk dashboard around.

I got **COMPASS**. 🧭

My first thought was "great, another map app with a needle on it." My second thought, about four minutes later while staring at the ceiling, was better: every compass ever made points you *somewhere else*. Not one of them tells you where you've already been. And the direction your life is actually heading is almost never the one you wrote down in January.

That became DriftLog, and I had 48 hours to make it real.

## Vision and What It Does

**DriftLog turns your daily wandering into a living map of who you're becoming.**

You drop pins — but not on places. On feelings. On the small win, the moment of nerve, the twenty minutes where something finally clicked. Each pin is a bearing on your inner landscape.

The core loop is deliberately tiny:

1. Pick one of eight bearings — clarity (N), creativity (NE), courage (E), connection (SE), calm (S), care (SW), curiosity (W), challenge (NW).
2. Slide the intensity from "a flicker" to "a landmark."
3. Write two sentences. That's the whole job.

Then the app draws your **compass rose** for the last seven days: a radar shape showing which way you've actually been drifting. Below it, your timeline — every pin, newest first.

It's for people who've bounced off journalling four times. I am one of them. Every journalling app I've tried asks for a blank page and a mood, and by day three the blank page has won. DriftLog asks for ten seconds and gives you a *shape* back. You can't argue with a shape. When the rose bulges east for three weeks running, that's not a vibe — that's data about your own courage.

The name is the honest part. You don't steer this thing. You drift, and DriftLog just keeps the log.

## The Full Stack Breakdown

Six episodes of The Full Stack, compressed into two days:

**Pitch.** The one-liner came before any code, and it survived unchanged: *drop pins not on places, but on feelings.* Whenever I got tempted by a feature (streaks! social! AI summaries!), I read the one-liner again and the feature died quietly. Good pitches are load-bearing.

**Prototype.** A single HTML file with eight buttons and a hardcoded array. No backend, no auth. I used it for one afternoon and learned the thing no spec would have told me: eight categories is right, but the *labels* matter enormously. My first list had "growth" and "progress" in it, and I could never decide which one a moment belonged to. Swapped them for "clarity" and "challenge" and the hesitation vanished.

**MVP.** Auth, persistence, the compass rose. I cut two headline features on purpose: the weekly Drift Pattern report and the EventBridge nudge notifications. The `/patterns` endpoint is built and tested — the UI just doesn't use it yet. Shipping a small thing that works beat shipping a big thing at 90%.

**UX.** Warm minimalist meets hand-drawn cartography: parchment cream, deep teal, amber, midnight ink. The paper grain is two offset radial gradients, so it costs zero network requests. Cmd+Enter submits, because the whole promise is ten seconds.

**Launch.** Terraform, one command, done. Which brings us to the fun part.

## How I Built It

### The pivot

I started on Amplify Gen 2 and switched to **Terraform** a few hours in. Not because Amplify is bad — it's excellent — but because I wanted to *see* every resource I was creating. The IAM policy on my Lambda is nine lines and grants exactly `PutItem`, `Query`, `DeleteItem` on exactly one table. I like being able to point at that.

### The constraint that made everything better

Somewhere around hour six I set myself a rule: **zero npm dependencies.** Not "few." Zero.

It sounds like showing off. It turned out to be the best decision of the build:

- The Lambda uses the AWS SDK v3 that already ships inside the Node 22 runtime, so Terraform's `archive_file` zips `backend/src` as-is. No bundler. No install step. No lockfile.
- The frontend talks to Cognito by POSTing `application/x-amz-json-1.1` directly. `InitiateAuth`, `SignUp`, `ConfirmSignUp` — they're just JSON endpoints. The entire "SDK" is one 20-line `fetch` wrapper.

Result: `terraform apply` is the whole deploy. Terraform zips the Lambda, creates the stack, renders `config.js` with the live resource IDs, and uploads the site to S3. There's no second step to forget at 3am. 🚀

### The bug that cost me an hour

My API returned 401 to everything. Tokens looked fine. Authorizer looked fine.

The API Gateway JWT authorizer validates the `aud` claim against your app client ID. Cognito **access tokens don't have an `aud` claim** — they have `client_id`. I'd been sending the access token. Switched to the ID token, which does carry `aud`, and everything lit up at once. 😅

### The bug that was funnier

My dark mode test kept failing: toggle to dark, read the background colour, still parchment. I stared at the CSS specificity for a solid ten minutes before it landed — `background-color` has a 0.25s transition, and `getComputedStyle` was faithfully reporting the *mid-animation* colour. The test was correct. The test was just extremely impatient. One `waitForTimeout(500)` later, green.

I also shipped a compass rose whose east and west labels read "creativi" and "iallenge," because I'd drawn labels at radius 112 inside a 240×240 viewBox. Turns out text has width. Who knew.

### Testing

Two suites, both dependency-light:

- **16 handler unit tests.** The AWS SDK is swapped for in-memory fakes using Node's module resolution hooks, so the file under test is the *exact* file Terraform ships — no test-only branches, no injected clients. They cover tenant scoping (every write is pinned to `USER#<sub>`), category and intensity validation, the "no timestamps from the future" rule, and that a DynamoDB failure becomes a 500 rather than a stack trace in the response body.
- **21 browser checks** in headless Chromium, with Cognito and the API stubbed at the network layer: sign-in, the exact POST payload, timeline rendering, delete, session persistence across reload, and the dark-mode toggle.

## AWS Services / Architecture

```
  Browser ──────▶ CloudFront ──▶ S3 (private, Origin Access Control)
     │              static site: index.html, app.js, styles.css, config.js
     │
     ├──sign in──▶ Amazon Cognito User Pool
     │
     └──ID token─▶ API Gateway HTTP API
                      │ JWT authorizer validates against the pool
                      ▼
                   AWS Lambda (Node 22, arm64)
                      │ least-privilege IAM
                      ▼
                   Amazon DynamoDB (single table, on-demand)
                      pk = USER#<sub>
                      sk = PIN#<ISO timestamp>#<uuid>
```

**Services:** CloudFront · S3 · Cognito · API Gateway (HTTP API) · Lambda · DynamoDB · IAM · CloudWatch Logs. **IaC:** Terraform.

The data model is the part I'm proudest of. Sorting by `sk` sorts by time for free, so the timeline is one `Query` and "last seven days" is the *same* `Query` with a `>=` condition. No GSI, no scan, no pagination gymnastics. The compass metaphor even survived into the schema: every pin stores its bearing in degrees.

Two things I'd fix before real traffic: Cognito's default email sender caps at ~50 messages a day (SES goes in `infra/cognito.tf`), and the API is throttled to 25 rps on purpose.

## What I Learned

**HTTP APIs are the good ones.** Built-in JWT auth, no custom authorizer Lambda, cheaper, faster. I have no reason to reach for a REST API again unless I need something exotic.

**Read the token, not the tutorial.** An hour lost to `aud` vs `client_id` is an hour I'll never lose again. Paste the JWT into a decoder *first*.

**A constraint is a design tool.** "Zero dependencies" sounded like a stunt and turned into the reason this deploys in one command. Arbitrary rules force you to actually understand the thing you were about to `npm install`.

**Ship the shape, not the vision.** The nudge notifications would have been lovely. The version that exists and works is lovelier.

And the one that wasn't about code: I've been using DriftLog while building DriftLog, and my rose is a lopsided blob pointing hard at "challenge." Which, for a 48-hour build, is about the most honest thing a compass has ever told me. 🧭

## Link to App or Repo

- **Live app:** `<YOUR CLOUDFRONT URL>`
- **Source:** https://github.com/jimmy-ao/The-Full-Stack-Challenge_DriftLog

The repo has the full Terraform stack, both test suites, and a `scripts/dev.sh` that serves the site locally against your deployed backend. Clone it, `terraform apply`, and you'll have your own compass in about five minutes.

Dark mode included. 🌞🌚
