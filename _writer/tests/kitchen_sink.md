---
title: Every feature, once
description: A test page for the writer.
date: 2026-10-18
tags: test
---

A paragraph with **bold**, *italic*, ~~struck~~, `code`, a [link](https://www.lesswrong.com), and "smart quotes". A footnote here[^1] and another[^long].

## A section

Inline math $e^{i\pi} + 1 = 0$ and a price of $5 stays text. Display math:

$$
\mathcal{L}(\theta) = -\sum_{t} \log p_\theta(x_t \mid x_{<t})
$$

- A bullet
  - nested bullet
    1. nested number
- Another bullet

1. First
2. Second

> A quote, with *emphasis*.
>
> And a second paragraph.

>! The butler did it.
>! He also took the cake.

+++ Click to expand
Hidden **content**, with a list:

- one
- two
+++

### A subsection

| Model | Tokens | Solved |
|---|---:|:---:|
| A | 500K | yes |
| B | 1M | yes |

```python
def f(x):
    return x ** 2  # $not math$
```

![A figure caption with *style*](https://res.cloudinary.com/lesswrong-2-0/image/upload/f_auto,q_auto/v1/mirroredImages/6Fpvch8RR29qLEWNH/umyybuqajf186nzzkgou "The caption, with *style*"){width=60%}

https://www.youtube.com/watch?v=pkwadgJORFM

::build /assets/img/posts/plm-slides/axes 4 "Two axes, or one?"

---

#### A sub-subsection

Text with <u>raw HTML</u> underline.

[^1]: A short footnote with $x^2$.
[^long]: A longer footnote.

    With a second paragraph.
