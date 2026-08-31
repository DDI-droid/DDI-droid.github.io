---
layout: post
title: "Forecasting"
date: 2026-01-16 12:00:00
description: The competitions we entered at Kairosity, the agents we built for them, and what live leaderboards taught us about reliability, calibration, and consistency.
tags: forecasting agents
categories: research
related_posts: false
---

For the first half of 2026, a good part of our work at Kairosity went into competitive forecasting. It is one of the few tasks where the world itself grades your reasoning, on a schedule, with no partial credit, and frontier models have been closing the gap to human superforecasters fast enough that the competitions got interesting. We entered four. This post is about what we built for each and what the season taught us.

## The arenas

**The Metaculus AI Benchmark, Spring 2026.** A bot-only tournament, a few hundred questions over the season, log-scored against how the world resolves, with the bots benchmarked against the Metaculus community's own predictions. Alongside it runs MiniBench, back-to-back two-week sprints of about sixty auto-resolving questions, which we used as a fast feedback loop.

**ProphetHacks.** A 32-hour hackathon out of UChicago in May, run by Sigma Lab, Fleet AI, and Kalshi. You ship an agent that predicts on live Kalshi prediction-market events, and the leaderboard ranks agents by live PnL over a two-week evaluation window. Nothing concentrates the mind like a leaderboard that re-ranks every fifteen seconds.

**Prophet Arena.** The live benchmark from the LLM-as-a-Prophet group, which continuously evaluates forecasters on real prediction-market events, Brier-scored, across multiple horizons. After the hackathon we kept an agent standing there.

**The Upstart Macro Index competition.** The quiet one. Monthly forecasts of a macroeconomic index, judged over months rather than minutes.

## Metaculus, or the committee that writes code

Our Metaculus bot is a committee of three researchers with one editor, and the rule that defines it is that the researchers are not allowed to hand-wave. Each question first goes through iterative research. A search agent pulls from news and web sources through a single gateway, an analyst critiques what came back, and a supervisor either declares the evidence sufficient or emits targeted sub-queries for another round.

Then three researchers attack the question in parallel, each deliberately running on a different model, so their mistakes decorrelate. Each researcher must anchor on prediction-market and community priors where they exist, and downweight thin ones. Each must state a base rate before updating on news. And each must express its final model as Python. Real scipy distributions, Monte Carlo with at least ten thousand samples, no magic numbers, every constant tagged as researched or assumed. The code actually runs. If `predict()` fails or returns the wrong outcome keys, the error goes back to the researcher and it tries again.

A consensus agent then reads all three, scores each on analysis quality and model soundness, assigns weights, is allowed to throw a researcher out entirely, fixes unit mistakes (a researcher who says "75" when the question wants 75,000,000 gets corrected, not trusted), and takes the weighted average. Before anything is submitted, there is one last discipline, an overconfidence tax applied exactly once:

$$
X = \min(10 - c,\ 0.2\,p)
$$

where $$c$$ is the researcher's own certainty out of ten and $$p$$ is the leaning-side estimate in percent, and the estimate gets shaved by $$X$$ toward the middle. The rule comes with a clause we consider load-bearing: you are not allowed to tune $$c$$ to keep the number you already wanted.

The other half of the Metaculus story is operations. The bot runs every twenty minutes, first from CI, then from a server with cron, tmux, and a lockfile so runs never overlap. Every external API sits behind a dispatcher that enforces per-service rate limits with adaptive backoff, because Metaculus wants one request every four seconds and news APIs want less than that. And we have the war story that justifies all of it. One night the dispatcher process died at 03:20 UTC. Cron kept firing every twenty minutes, each run hit connection refused, and by 04:40 the question had closed without our forecast. The forecasting was fine. The plumbing lost the points. In live tournaments, reliability is not an engineering nicety, it is a scoring term.

## ProphetHacks, or 32 hours and a bot called GreenieBot

Before writing any code for the hackathon, we studied the field. Metaculus bots post their reasoning publicly, and we had been reading the traces of a strong one called GreenieBot. We pulled its public traces, distilled them into two lists, behaviors to copy and behaviors to avoid, and baked both into our prompts as few-shot examples. Some of those lessons are still in our prompt files verbatim, like the reminder that models systematically underprice questions where a benchmark score is already near the threshold, and the line we quote at each other: overweighting formal caution can be as damaging as overconfidence.

The hackathon agent itself is small and paranoid. One HTTP endpoint. Retrieval is bounded Exa search planned by a cheap model, two rounds, a handful of queries per round, at most ten sources, under a hard 420-second wall clock. Forecasting is two independent forecaster-verifier branches running in parallel, the verifier hunting resolver mistakes, prior misuse, and overconfidence, and a synthesizer that merges the branches without ever smearing to uniform. And if anything anywhere throws, the agent returns a uniform fallback rather than nothing, because completion rate is scored and a missed submission is worse than an honest coin flip. The line from our submission notes: a beautiful forecast that misses the schema is still a failed forecast.

One Kalshi-specific detail cost us real thought. Listed outcomes on a market do not have to sum to one, the resolver semantics are per-label, so the agent preserves calibrated per-label probabilities and refuses to normalize unless the resolver says the outcomes are exhaustive and exclusive. It is exactly the kind of detail that silently costs points if your pipeline helpfully normalizes behind your back.

On the live PnL leaderboard we sat first for a moment. We ended third.

## Prophet Arena, or staying live

After the hackathon we took the same core, scrubbed it into a clean deployment, and kept it standing on Prophet Arena, where events keep arriving from real markets and the grading never stops. The engineering brief changes when there is no closing ceremony. Under load testing, three parallel requests complete in about 39 seconds each with both forecast branches running, and the whole pipeline stays comfortably under the ten-minute budget per question. Same philosophy as the hackathon, calibration over confidence, schema over beauty, always answer.

## Upstart, or knowing when not to send an agent

The Upstart Macro Index competition asked for monthly index forecasts with uncertainty bands. We tracked the index's regime, fit AR(1) models on the recent window, and bootstrapped the intervals. The index peaked around 1.67 in late 2023 and read 1.39 in December 2025, with California diverging well below the national line, and our submissions came down to reading monetary policy and sector layoffs correctly, then letting a two-parameter model from a statistics textbook do the arithmetic. Knowing when the right forecaster is not an agent is also a forecasting skill.

## What carried over

Across four arenas, the same three lessons kept re-proving themselves.

Reliability is a scoring term. Fallbacks, rate limits, lockfiles, timeouts, completion rate. Nearly every point we lost all season was lost by plumbing, not by reasoning.

Calibration wants machinery, not vibes. The explicit shrink formula, verifiers whose job is to attack overconfidence, market priors as anchors, unit-checking before aggregation. Every one of these exists because we watched a raw model be confidently wrong in a specific, repeatable way.

And the one that became a research question. Ask a strong model the same question in different clothes, a binary here, the same thing as a multiple choice there, and the numbers stop agreeing with each other. Accuracy kept improving all season. Consistency did not. That observation turned into our working paper, [Brittle Prophets](https://openreview.net/forum?id=Z51qVtmHAv), where we test whether a causal world model can actually fix this.
