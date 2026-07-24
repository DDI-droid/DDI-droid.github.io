---
layout: post
title: Fixing Table Bounding Boxes with RL
date: 2025-08-17 12:00:00
description: Teaching a neural network to repair a table detector's bounding boxes, with geometric rewards in the open version and a vision model as the judge in the applied one.
tags: rl ocr systems
categories: research
related_posts: false
---

At Decimal Point Analytics I work with financial documents, and financial documents contain a lot of tables. This problem was plaguing us: our docket pipeline at the time genuinely struggled with tables. Detection comes first, a model draws bounding boxes around rows and cells, and everything downstream trusts those boxes. The boxes drift, rows merge, phantom rows appear, and long tables make it worse, by the bottom of one it gets hard to make sense of anything. Every bad box becomes a corrupted record two stages later.

The usual fix is to fine-tune the detector with more labeled pages, and labeling table geometry is miserable work. So we tried a different route: keep the detector, and train a second model to repair its output. It did not start from scratch. The starting point was the prediction from Surya OCR, a very powerful OCR at the time, and the neural network learned to correct the mistakes in those bounding boxes.

## The idea

The environment is a page. The state is the detector's boxes laid over the words it found. The network's actions are small edits, nudge a box edge, delete a row box, halt when done. An episode starts from what Surya produced and ends with what the network left behind, and the reward measures whether the boxes ended up agreeing with the words on the page.

That reward came in two designs. The first is geometric, computed from the page itself: how cleanly the row boxes cut between word clusters, how many words end up owned by exactly one row, whether a deleted row was one the words never needed. That version is implemented in the open code. The second design replaces geometry with judgment, an OpenAI vision model looks at the boxed page and scores it. The applied version went that way, and the honest note from the code's own header is that it works even when the judge is somewhat jank.

<!-- FIGURE 1: training curve (correctness over agent steps) goes here once the file lands -->

<!-- FIGURE 2: boxed table render (row boxes red, word boxes green) goes here once the file lands -->

It worked a lot better than we expected, the repaired boxes showed real gains over the detector's own, and a version of this went into use internally at DPA. The environments are C, built as PufferLib Ocean environments and trained with PufferLib's PPO, which is what made iterating on a page-sized state cheap enough to try ideas like this at all.
