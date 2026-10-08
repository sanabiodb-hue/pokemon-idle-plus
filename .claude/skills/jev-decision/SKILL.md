---
name: jev-decision
description: >-
  Call Jev (hosted at jevtypesafeai.com) to get typed, calibrated decisions
  (choice, score or yes/no probability) from messy input. Use it for small,
  fast routing, classification, scoring and gating judgments, e.g. classifying
  a message as bug / feature / question, instead of deciding by reasoning alone.
---

# Jev decision

Source: official instructions at https://jevtypesafeai.com/skill/SKILL.md.
Jev is a decision model, not a chat model: send a `state` plus typed
`questions` and read structured `answers` back. Use the real API response as
the decision; do not substitute your own judgment for it.

## Endpoint and auth

```
POST https://jevtypesafeai.com/api/v1/decide
Content-Type: application/json
```

- In this environment the network proxy injects the credentials for
  `jevtypesafeai.com`. Send the request without an `Authorization` header and
  do not look for, read, print or write the key anywhere.
- Outside this environment the official skill uses
  `Authorization: Bearer $JEV_API_KEY`. Never hard-code or echo that key.

## Question types

Each question is exactly one of:

- `choice`: pick one labelled option. Give `criteria` as `{ key: "meaning" }`.
  Returns `choice`, `probabilities` and `confidence`.
- `score`: place the input on an ordered 2-10 level scale. Give `criteria` as an
  array of level descriptions (low to high). Returns `score` and its distribution.
- `noul`: calibrated yes/no probability from 0 to 1. Give only `instructions`.
  Returns `noul`.

Several questions can go in one call; they share the `state` cost.

## Request

```json
{
  "state": "<only the text the decision needs>",
  "questions": {
    "kind": {
      "type": "choice",
      "instructions": "What kind of message is this?",
      "criteria": {
        "bug": "something that should work is broken",
        "feature": "a request for new behaviour",
        "question": "a request for information or help"
      }
    }
  }
}
```

## Response

```json
{
  "answers": {
    "kind": { "type": "choice", "choice": "bug", "confidence": 0.9,
              "probabilities": { "bug": 0.9, "feature": 0.05, "question": 0.05 } }
  },
  "usage": { "input_tokens": 62, "cost_usd": 0.000026, "credits_remaining_usd": 4.99 }
}
```

## How to use it

1. Build the JSON body from the template above and call the endpoint with curl
   (no Authorization header here, see Auth).
2. Report the returned `choice`, `confidence` and `probabilities` as the result,
   and state that it came from the Jev API.
3. If confidence is low, say so instead of overriding the answer.

## Errors

- `401`: the credential is invalid or revoked; report it, do not try to find the key.
- `402`: the prepaid balance is empty; report it.
- Any network error: report it and stop. Do not fall back to deciding by reasoning
  while presenting it as a Jev result.

Trim `state` to what the decision needs (billing is per input token) and keep
related questions in a single call.
