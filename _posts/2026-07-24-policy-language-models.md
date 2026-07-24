---
layout: post
title: Policy Language Models
date: 2026-07-24 12:00:00
description: A complementary axis of inference-time scaling that biases the LLM toward abstract computational reasoning. What an RLM does for its input, a PLM does for all its computation.
tags: llm meta-reasoning
categories: research
related_posts: false
---

This post introduces what I'm working on right now, Policy Language Models. It is drawn from the paper, compressed, and linked at the end.

## The trajectory

Frontier large language models and the harnesses built around them can now tackle complex long-horizon problems, resolve software issues, conduct deep research, and drive hours-long sessions. The gains that enabled this have largely arrived through inference-time scaling. Models are trained to spend more tokens deliberating, and ReAct systems extend those capabilities by interleaving reasoning with actions and observations. ReAct remains the dominant substrate for this work, and a ReAct trajectory is a growing sequence of those thoughts, actions, and observations.

The trajectory only grows, every thought, action, and observation is appended, and LLM outputs degrade as the context window fills. The most popular general remedy is context compaction, where the trajectory is repeatedly summarized when it exceeds a length threshold. Compaction loses information, and it does not repair the reasoning inside the window. Trajectories pushed to length fail in characteristic ways, exploration that fragments the reasoning, self-reflection that strains against load-bearing mistakes, the capacity of the window itself; the short version is a single mismatch. The model repeatedly reaches for reasoning shapes the autoregressive substrate cannot hold: it branches to weigh alternatives, reverts to undo a wrong step, and explores before committing, yet every such move is flattened back into one forward sequence. We believe these failures act as a dampener on reasoning LLMs, and that solving them will yield far more capable reasoners.

## Taking work off the line

Recently, [Zhang, Kraska, and Khattab](https://arxiv.org/abs/2512.24601) introduced Recursive Language Models (RLMs), a general-purpose inference paradigm for dramatically scaling the effective input and output lengths of LLMs. Their key insight is that an arbitrarily long prompt should not be fed into the neural network directly, but treated as part of the environment that the LLM symbolically and recursively interacts with. Given a prompt $$P$$, an RLM initializes a REPL environment in which $$P$$ is set as the value of a variable, and the model writes code that peeks into and decomposes $$P$$, observes the side effects of execution, and invokes the LLM itself on as many slices of the input as necessary. What leaves the trajectory, though, is the input/output processing alone. Thinking, exploration, reflection, action, and observation still accumulate on it, and the thinking is still done the ReAct way.

## Policy Language Models

We introduce Policy Language Models (PLMs), a general-purpose meta-reasoning inference paradigm for dramatically scaling the reasoning power of LLMs. What an RLM does for its input/output, a PLM does for all its computation. Instead of reasoning and computing inline, a PLM authors policies: programmatic artifacts it can run, edit, and compose, and lets them carry the work a trajectory would otherwise hold, the mechanical steps, the reasoning, the interaction with the world. Policies live and execute in a persistent REPL environment. The harness also provides sub-LLM functional policies, so a PLM can create policies capable of reasoning and computation, and its constraint abstraction lets the PLM fix the invariants of any policy's output, the sub-LLM policies included. The REPL is the only way a PLM acts. It is not confined to authoring policies there, it can inspect, compute, and act directly, much as an RLM does. What makes it a meta-reasoner is not a prohibition on doing the work itself but a disposition, trained into it, to author policies that do the work better than it would inline.

The trajectory itself is responsible for abstract reasoning. There the PLM reasons over the goal and authors the policies that set its plans in motion: policies to test its hypotheses, policies to process inputs, policies to write and output code. A PLM's job is not to run systems but to reason; it engineers its instruments with an understanding of the goal, sees the work they did, and reasons onward. And since reading an input is itself computation, the RLM capability comes along as a special case, a long input can sit in the environment and be worked through with policies.

<div class="text-center">
  <img src="/assets/img/posts/plm-evolab.png" alt="A PLM authoring an evolutionary policy" style="max-width: 100%;">
</div>
<p class="text-center" style="font-size: 0.9em; color: #6b7280;"><em>A PLM reasons about the goal abstractly and expresses the computation as policies. Here, the PLM authors a single evolutionary policy that breeds candidate policies through sub-LLM builders, selects among them by played outcomes, and folds only gated winners into its deliverable.</em></p>

What the substrate buys is compounding. A policy authored once can be rerun, revised, and composed into larger ones, so the work of reasoning accumulates as artifacts rather than as tokens. The substrate alone, however, does not produce the behavior. In our experiments, current LLMs placed on the PLM harness do not spontaneously meta-reason, they grind the work inline out of habit, or scatter one-off delegations that are at best half-cooked. The disposition has to be trained in. We take that as the finding that matters: meta-reasoning is a trainable surface of improvement that today's models have never been optimized for.

## The harness

A Policy Language Model is a large language model that meta-reasons: it reasons about the goal on its own trajectory and expresses the computation as policies in a persistent programming environment $$\mathcal{E}$$. Each round the model thinks abstractly, then acts through one code tool call that executes in $$\mathcal{E}$$ and updates its state. A PLM trajectory holds only three things: the abstract reasoning, the code, and the code's output as the tool result.

Meta-reasoning is the axis of inference along which the model reasons about the goal and reasons about generating the computations that will help attain it. It is three abilities held together: the ability to reason abstractly about the goal; the ability to reason and generate optimal compute structures for tasks; and the behavior that binds the two, in which the model reasons about what to do and how to do it, inlines or expresses the task as computation, benefits from its result, and reasons on.

A policy is any computation the PLM expresses rather than performs. The definition is behavioral, not syntactic, and the harness gives it support: the `@policy` decorator turns a function or a class into a named artifact that persists across rounds, holds global scope so it is used by name and never imported, and can be edited in place and duplicated. Authored once, it can be rerun, edited, and composed into larger policies.

The harness gives the PLM three LLM policies to build with: `natural_llm` is a single llm call; `react_llm` is an LLM with the python tool, run in ReAct rounds; and `react_verifier_llm` is a special `react_llm` with a policy that runs after each round to manipulate the llm's trajectory. Bare minimum on their own, they can be used to build arbitrarily complex information processing circuits. The building, however, is deliberate work: every sub-llm call begins empty. Every input, helper, prompt, any policy it will use, the `@policy` decorator and the LLM policies themselves, are handed to it. Nothing about a sub-llm is ambient, so a working one is constructed, not summoned. Fanning out is never a reflex but a decision the PLM has to make and build, so it decomposes only when it decides to. And this costs no expressive power: a PLM can build an RLM, or even an unbounded-depth PLM, as a policy inside its depth-two harness. Computation can never be fully controlled or predicted, but a harness decides who holds what control there is. Ours concentrates it in the PLM. An RLM scatters it across the tree.

Constraints and message weaving complete the harness. A constraint is a way to define invariants over a computation's output, authored as a typed class. An LLM's judgment so becomes a typed value in ordinary control flow, `while react_llm("...", constraint=Bool)` either runs or raises, and there is no third outcome. Message weaving makes trajectories the same kind of object: messages pass by reference, so a `react_llm` run over a list leaves its turns on that list, and the list can be handed onward as an object, to a second policy that inspects the reasoning, never as pasted text; the PLM's own trajectory is available the same way, as a live copy.

## What has to be trained

Placed on the harness untrained, current models delegate but do not meta-reason, and the affinity improves little under prompting, even with detailed, optimized system prompts, reasoning models hold to the habits of the single trajectory. The disposition has to be trained in, and the training is not only subtractive. Taking work off the trajectory is half of it, the other half is new duties, authoring, granting, briefing, weaving, that no model has ever been trained to perform. How meta-reasoning is enforced, how it is rewarded, how it is discovered at all, are open questions, and we leave them open deliberately. The substrate is more powerful than the one it is compared to, and that is exactly why it must be trained. Developing that training is the program of this work.

---

*The paper is in progress.*
<!-- OVERLEAF LINK: when the view-only link arrives, replace the line above with: *The paper is in progress; a read-only draft is available [here](LINK).* -->
