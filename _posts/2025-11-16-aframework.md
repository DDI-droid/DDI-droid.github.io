---
layout: post
title: "AFramework: separating the app from the inference"
date: 2025-11-16 12:00:00
description: Why I built an agent framework that separates applications from LLM inference, and a tour of how it works.
tags: systems llm agents
categories: engineering
related_posts: false
---

<div class="text-center">
  <img src="/assets/img/posts/aframework-logo.png" alt="AFramework" style="max-width: 300px;">
</div>

AFramework is an agent framework, that is what the A stands for. I built it at Kairosity, and this is its open-source version. The idea fits in one line: separate the applications that use LLM inference from the inference itself.

## Why

Picture one machine's worth of CPU and RAM, and many applications that all want LLM-driven work done on it. The GPU side of this separation already has its answer: vLLM sits between the model and everyone who wants a forward pass, and schedules those passes well. But an agentic workload is not a forward pass. A ReAct-style task is long stretches of I/O, tool calls, API waits, retrieval, braided with bursts of CPU work, and the model call is only one piece of it. For that side of inference there is no shared substrate, so every application builds its own orchestration, its own rate limiting, its own retries, around the same recurring needs.

AFramework is that substrate. An application submits a task over a socket and stops caring. A shared daemon runs it, next to every other application's tasks, and optimizes the whole load on whatever the box has.

There is also a blunter reason. The popular frameworks in this space break often, LangChain most famously, and the design goal here was the opposite of a framework that does everything: a small daemon with a narrow contract that stays up.

## The shape of the system

You do not start AFramework. The first client call that needs it starts the daemon on a Unix socket if one is not already answering, and plugin modules load lazily, only the ones your spec names. For a long-lived deployment you can run the daemon yourself, but nothing requires it.

Work runs in isolated worker processes, real parallelism rather than one event loop pretending. A supervisor health-checks the workers, respawns the dead ones, and drains them on shutdown.

Behavior lives in agent cores. The default core runs a reasoning loop with a model backend and a verifier attached, and custom cores define their own contract with the worker. Everything is specified as plain dicts naming a class, backends are swappable, vLLM, OpenAI, Anthropic, and MCP servers are first class.

Results are durable. A client can submit a task, die, and a different client can later ask for the result and get the same answer, or the same error. Errors are fail-fast and typed: a failing task marks itself failed with a structured error payload, its coroutine dies alone, and the worker keeps serving everything else.

## Keeping many apps honest

Sharing a box is a promise applications break on each other, so enforcement is central rather than per-app. Rate limits are Redis-backed token buckets on named resource keys, with circuit breakers over failing resources, and policies declared in one YAML file. Resource keys can be tenant-qualified, `acme.openai:gpt-4` style, so "many applications" can also mean "many tenants" without one of them eating the budget of the rest.

## The router

Somebody has to decide which worker a task lands on, and round-robin is the answer most systems settle for. AFramework routes by cost. For each candidate worker it estimates the expected latency of this task on that worker, from the worker's projected CPU and I/O load, with memory pressure and event-loop lag as hard constraints, and a warm-start bonus when a worker has recently run tasks of the same kind. On large fleets it samples a few candidates, power-of-d-choices; on small fleets it simply scans them all.

The part I like most: task costs are not configured anywhere. They are learned online, per task signature, with Bayesian changepoint detection watching for the moment a task's behavior shifts regime, so the profile follows the workload instead of trusting old evidence. The router deserves a post of its own, so this section is deliberately the short version.

## The C++ underneath

The hot path is C++ where it matters, the dispatch queues between router and workers, the scheduler, and the logger's wire service, each with a Python fallback so the framework still runs unbuilt, just slower. The reasoning is boring and firm: dispatch overhead is paid by every task that moves, so the dispatch path is the one place that must never be the bottleneck.

## Using it

```python
import asyncio
from AFramework.agent_core import BaseAgentCoreClient

async def main():
    model_backend = {
        "model_backend_class_name": "VLLMBackend",
        "model": "Qwen/Qwen3-30B-A3B-Thinking-2507",
    }
    client = BaseAgentCoreClient(agent_id="my_agent")
    client.register_model_backend(**model_backend)
    client.register_verifier(
        verifier_class_name="BaseVerifier",
        model_backend=model_backend,
        max_verification_steps=20,
    )

    session_id = await client.execute_task(
        messages=[{"role": "user", "content": "Hello world"}],
        stream=True,
    )
    print(f"Task started with Session ID: {session_id}")

if __name__ == "__main__":
    asyncio.run(main())
```

That is the whole ceremony. No daemon management, no service files, the framework comes up behind the first call and the task runs in a worker with routing, rate limits, and durability underneath it.

## What is not here

There are no benchmark numbers in this post because none are published yet; everything above is a claim about design, not measurements. The TODO list is public in the repo, multi-tenant MCP transport, router enhancements, the usual honest backlog.

AFramework is open source on [GitHub](https://github.com/Curiosity-Oneiroi/AFramework).
