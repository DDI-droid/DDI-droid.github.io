---
layout: post
title: Fixing table boxes with RL
date: 2025-08-17 12:00:00
description: Teaching an agent to repair a table detector's bounding boxes, with geometric rewards in the open version and a vision model as the judge in the applied one.
tags: rl ocr systems
categories: research
related_posts: false
---

At Decimal Point Analytics I work with financial documents, and financial documents are tables. Extracting them starts with detection, a model draws bounding boxes around rows, columns, and cells, and everything downstream trusts those boxes. The detectors are good and not good enough: boxes drift, rows merge, phantom rows appear, and every error becomes a corrupted record two stages later.

The usual fix is to fine-tune the detector with more labeled pages. Labeling table geometry is miserable work, so I tried a different route: keep the detector, and train a second model to repair its output.

## The idea

The environment is a page. The state is the detector's boxes laid over the words it found. The agent's actions are small edits, nudge a box edge, delete a row box, halt when done. An episode starts from what the detector produced and ends with what the agent left behind, and the reward measures whether the boxes ended up agreeing with the words on the page.

That reward came in two designs. The first is geometric, computed from the page itself: how cleanly the row boxes cut between word clusters, how many words end up owned by exactly one row, whether a deleted row was one the words never needed. That version is implemented in the open code. The second design replaces geometry with judgment, an OpenAI vision model looks at the boxed page and scores it. The applied version at DPA went that way, and the honest note from the code's own header is that it works even when the judge is somewhat jank.

<!-- FIGURE 1: training curve (correctness over agent steps) goes here once the file lands -->

There were two generations. The first, table_transformer, let the agent push individual cell-box edges around and call halt. The final one, table_ocr, is framed entirely as repair: it logs the initial detection's quality and the post-agent quality side by side, so the only thing being optimized, and the only thing being reported, is the improvement over what the detector already did.

<!-- FIGURE 2: boxed table render (row boxes red, word boxes green) goes here once the file lands -->

It worked, for some of it, the runs climb well above the initial detection's correctness before the usual RL regime wobbles set in, and a version of this is used internally at DPA. The environments are C, built as PufferLib Ocean environments and trained with PufferLib's PPO, which is what made iterating on a page-sized state cheap enough to try ideas like this at all.

The part I keep thinking about is the reward split. Geometry is free and honest but blind to semantics; a vision judge understands the table but hallucinates opinions. The applied answer was the judge. The principled answer is probably both, and that question, when a learned judge is trustworthy enough to train against, is much bigger than tables.
